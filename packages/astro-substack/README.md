# Astro Substack

> [!WARNING]
> **Experimental Package** — This package is under active development and may contain breaking changes between versions. Use at your own discretion in production projects.

Fetch public posts from any Substack publication and use them in Astro — at build time, with zero runtime dependencies.

## Install

```sh
npm install astro-substack
pnpm install astro-substack
yarn install astro-substack
```

## Usage

### `SubstackInitiator`

`SubstackInitiator` is a minimal, dependency-free client for reading **public** Substack content. It accepts a publication handle — a full URL (`https://yourpub.substack.com/`), a custom domain, or a bare handle (`yourpub`) — and normalizes it internally.

```ts
import { SubstackInitiator } from "astro-substack";

const client = new SubstackInitiator("https://fadlansthought.substack.com/");
```

### `fetchPublications()`

Fetches the publication's posts from the unofficial archive endpoint (`/api/v1/archive`) and maps them to a clean, typed shape.

```ts
const posts = await client.fetchPublications();

// With options
const latest = await client.fetchPublications({
  limit: 10,       // 1-50; see below
  sort: "new",     // "new" | "top" | "pinned" | "community"
  timeoutMs: 15_000,
});
```

#### Options

| Option      | Type                                                | Default  | Behavior                                                                                                                                                  |
| ----------- | --------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limit`     | `number`                                            | —        | `1`-`50` (server-side max). **Omitted** = the `limit` param is not sent and Substack returns **all** posts. **Invalid** values (non-integer, `< 1`, `> 50`) fall back to `50`. |
| `sort`      | `"new" \| "top" \| "pinned" \| "community"`         | `"new"`  | Archive sort order.                                                                                                                                       |
| `timeoutMs` | `number`                                            | `15000`  | Request timeout via `AbortSignal.timeout`.                                                                                                                |
| `proxyBaseUrl` | `string`                                         | —        | Route the request through a fetch proxy: `<proxyBaseUrl>?url=<encoded archive URL>`. Needed on datacenter IPs (GitHub Actions, most CI), where Substack's Cloudflare 403-challenges direct requests. See [CI / datacenter IPs](#ci--datacenter-ips). |

#### Return shape

`Promise<SubstackPublicationPost[]>`

```ts
interface SubstackPublicationPost {
  id: number;             // Numeric post id from the Substack API
  title: string;          // Post title (plain text)
  subtitle: string | null;
  slug: string;           // e.g. "are-you-tone-deaf-for-practicing"
  postDate: string;       // ISO 8601, e.g. "2026-09-19T15:59:11.064Z"
  canonicalUrl: string;   // Canonical URL on Substack
  coverImage: string | null;
  audience: string;       // Raw audience field ("everyone", "paid", ...)
  isPaywalled: boolean;   // audience "paid" or is_paid truthy
  type: string;           // Raw post type ("newsletter", "podcast", ...)
}
```

### Astro page example

Because fetches run server-side (at build time for static output), the missing CORS headers on Substack's API are not a problem:

```astro
---
import { SubstackInitiator } from "astro-substack";

const client = new SubstackInitiator("https://yourpub.substack.com/");
const posts = await client.fetchPublications();
---
<ul>
  {posts.map((post) => (
    <li>
      <a href={post.canonicalUrl}>{post.title}</a>
      <time datetime={post.postDate}>{new Date(post.postDate).toDateString()}</time>
    </li>
  ))}
</ul>
```

> [!WARNING]
> The Substack archive endpoint does **not** send `Access-Control-Allow-Origin`, so calling `fetchPublications()` from browser JavaScript on another domain will be blocked by CORS. Use it server-side (Astro frontmatter, endpoints, SSR) or behind a same-origin proxy.

## Static Build Mode

For static site generation, use `StaticSubstackInitiator`, which extends `SubstackInitiator`
with `saveStaticPosts()` (fetch + persist) and `loadStaticPosts()` (read back at build time).

The fastest way to start is the bundled CLI. It scaffolds an env-driven prebuild script in
your project:

```sh
npx astro-substack init --publication https://yourpub.substack.com/
```

This creates `scripts/prebuild.mjs` and prints the `package.json` script block to paste. The
generated script reads its configuration from the environment — never hardcoded. To replace
an existing scaffold, re-run with `--force`.

### Configuration (env)

| Variable                   | Required | Meaning                                                                                          |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `SUBSTACK_PUBLICATION_URL` | **yes**  | The publication to fetch. Missing → the script exits with an error (no silent fallback).          |
| `SUBSTACK_LIMIT`           | no       | Posts per build, `1`-`50`. Out-of-range values warn and clamp to the server-side max of `50`.     |
| `SUBSTACK_SORT`            | no       | `"new"` (default) \| `"top"` \| `"pinned"` \| `"community"`.                                      |
| `SUBSTACK_PROXY_URL`       | no       | Base URL of a fetch proxy for CI. See [CI / datacenter IPs](#ci--datacenter-ips).                 |

Values come from the process environment, or from `.env` / `.env.local` via the zero-dependency
loader inside the script (process env wins). `.env` is not needed by Astro itself — only by the
prebuild.

### CI / datacenter IPs

Substack's Cloudflare 403-challenges requests from datacenter IPs — GitHub Actions runners, most
CI — regardless of User-Agent, on both the archive endpoint and the RSS feed (verified 2026-09-30;
the same requests pass from residential IPs). If your prebuild fails with
`Substack archive returned HTTP 403`, route it through a fetch proxy: deploy the bundled
Cloudflare Worker (`examples/worker-proxy`) and point `SUBSTACK_PROXY_URL` at it.

```sh
cd examples/worker-proxy && npx wrangler deploy
# → https://astro-substack-archive-proxy.<your-subdomain>.workers.dev
```

```sh
SUBSTACK_PROXY_URL=https://astro-substack-archive-proxy.<your-subdomain>.workers.dev
```

The worker only proxies `https://*.substack.com` URLs, so it is not an open proxy. Publications
on custom domains are not proxied by the bundled worker.

### Prebuild Script

`npx astro-substack init` generates this file; you can also copy it:

```javascript
// scripts/prebuild.mjs
import { StaticSubstackInitiator } from "astro-substack";

const handle = process.env.SUBSTACK_PUBLICATION_URL;
if (!handle) {
  console.error("SUBSTACK_PUBLICATION_URL is not set. Add it to .env.");
  process.exit(1);
}

await new StaticSubstackInitiator(handle, process.cwd()).saveStaticPosts({
  limit: process.env.SUBSTACK_LIMIT ? Number(process.env.SUBSTACK_LIMIT) : undefined,
  sort: process.env.SUBSTACK_SORT || "new",
});
```

The full generated script also loads `.env` / `.env.local` and removes a stale
`__substack_rendered/posts.json` before fetching, so a failed fetch can never leave the previous
publication's posts behind for the build to silently pick up.

### package.json

```json
{
  "scripts": {
    "prebuild": "node scripts/prebuild.mjs",
    "build": "npm run prebuild && astro build",
    "dev": "npm run prebuild && astro dev"
  }
}
```

### Astro Page

The publication handle is written into `meta.handle` by the prebuild, so the page reads it from
disk and needs **no env access** (`.astro` runs under Vite, where env resolution differs from
plain Node):

```astro
---
import { StaticSubstackInitiator } from "astro-substack";

const client = new StaticSubstackInitiator("unused-at-build-time", process.cwd());
const { meta, posts } = await client.loadStaticPosts();
---

<p>Publication: {meta.handle}</p>
<ul>
  {posts.map((post) => (
    <li>
      <a href={post.canonicalUrl}>{post.title}</a>
      <time datetime={post.postDate}>{new Date(post.postDate).toDateString()}</time>
    </li>
  ))}
</ul>
```

> **Note:** The `__substack_rendered/` directory is created in your project root by the prebuild script. Do not commit it to version control — add it to `.gitignore`.

> **Schema Versioning:** The JSON format includes a `version` field (`meta.handle` is an
> additive field and does not bump it). If you encounter "Unsupported static posts schema
> version" errors, update the `astro-substack` package.

> **Design Note:** Persistence (saving to `__substack_rendered/`) is deliberately a separate function (`saveStaticPosts()`) rather than a flag on `SubstackInitiator`, so the core class remains browser-safe and environment-agnostic.

### Import paths

- The package root is the single entry: `import { SubstackInitiator, StaticSubstackInitiator } from "astro-substack";`. The previous `astro-substack/lib/*` deep imports no longer exist.
- The `Hello` component ships under the `astro-substack/astro` subpath: `import Hello from "astro-substack/astro";`. The root entry never resolves a `.astro` file.

> **Known limitation:** the `astro-substack/astro` types ship as a global `declare module "*.astro"` wildcard, which can mask a genuinely missing `.astro` import in your own project.

## Tests

Unit tests use the built-in `node:test` runner (Node >= 22.12):

```sh
pnpm test:unit                       # from the workspace root
# or, inside packages/astro-substack:
node --test                          # offline, stubbed fetch
SUBSTACK_LIVE_TEST=1 node --test tests/substack-live.test.ts   # hits the live API
```

## License

MIT
