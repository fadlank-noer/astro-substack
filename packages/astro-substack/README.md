# Astro Substack

> [!WARNING]
> **Experimental Package** — This package is under active development and may contain breaking changes between versions. Use at your own discretion in production projects.

Fetch public posts from any Substack publication and use them in Astro — at build time, with a single runtime dependency ([fast-xml-parser](https://www.npmjs.com/package/fast-xml-parser), used to parse the RSS feed).

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
| `proxy`     | `"own" \| "public"`                                 | —        | `"public"` = route through the shared public proxy (`https://astro-substack-proxy.fadlank.web.id`, zero setup). `"own"` = use `proxyBaseUrl` (required; missing URL throws a `RangeError`). See [CI / datacenter IPs](#ci--datacenter-ips). |
| `proxyBaseUrl` | `string`                                         | —        | Your own fetch proxy: the request goes to `<proxyBaseUrl>?url=<encoded archive URL>`. Needed on datacenter IPs (GitHub Actions, most CI), where Substack's Cloudflare 403-challenges direct requests. Ignored when `proxy: "public"` is set. See [CI / datacenter IPs](#ci--datacenter-ips). |

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

### `FeedSubstackInitiator`

An alternative client that reads the publication's **public RSS feed** (`{handle}/feed`) instead of the archive API. Same `fetchPublications()` entry point and the **same lean return shape** as the archive client — the list carries no content. The feed's XML is parsed with [fast-xml-parser](https://www.npmjs.com/package/fast-xml-parser), the package's only runtime dependency.

```ts
import { FeedSubstackInitiator } from "astro-substack";

const client = new FeedSubstackInitiator("https://fadlansthought.substack.com/");

// 1. The lean list — same shape as SubstackInitiator.fetchPublications()
const posts = await client.fetchPublications({ limit: 10 });

// 2. Full content per post — a SEPARATE function. RSS has no per-post
//    endpoint, so this re-reads the feed and matches on canonicalUrl/slug.
const content = await client.fetchPostContent("are-you-tone-deaf-for-practicing");
// content.bodyHtml — the FULL post body (from content:encoded)
// content.author   — the byline (from dc:creator)
```

`fetchPostContent(key, options?)` returns a `FeedSubstackPostContent` (`title`, `postDate`, `canonicalUrl`, `slug`, `author`, `bodyHtml`) or `null` when the feed holds no such post. `key` is the post's `canonicalUrl` or just its `slug`. Each call costs one feed fetch — cache the result when you need content for many posts. `proxy`, `proxyBaseUrl`, `timeoutMs`, and `retryDelayMs` are honored (the proxy is required on CI).

Differences of the LIST from `SubstackInitiator.fetchPublications()`:

| Field / option | Feed behavior |
| -------------- | ------------- |
| `id`           | Always `0` — the feed exposes no numeric post id; the GUID is the post URL. Key on `canonicalUrl` / `slug`. |
| `audience`, `isPaywalled`, `type` | Not exposed by the feed; defaults `"everyone"`, `false`, `"newsletter"`. |
| `limit`        | Applied client-side after parsing (the feed has no pagination). Invalid values are ignored. |
| `sort`         | Accepted for signature compatibility, no effect — the feed is always newest-first. |
| Coverage       | The feed is a recent-posts **snapshot**, not the publication's full archive. |

`timeoutMs`, `proxy`, `proxyBaseUrl`, and `retryDelayMs` behave exactly like the archive client — the feed is Cloudflare-fronted too (see [CI / datacenter IPs](#ci--datacenter-ips); `proxy: "public"` uses the shared proxy at `https://astro-substack-proxy.fadlank.web.id`).

## Static Build Mode

For static site generation, use `StaticSubstackInitiator`, which extends `SubstackInitiator`
with `saveStaticPosts()` (fetch + persist) and `loadStaticPosts()` (read back at build time).

The fastest way to start is the bundled CLI. It scaffolds an env-driven prebuild script in
your project:

```sh
npx astro-substack init --publication https://yourpub.substack.com/
```

It can also scaffold your own fetch-proxy worker (`npx astro-substack proxy`) — see
[Own proxy worker](#own-proxy-worker).

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

### Own proxy worker

The CLI can scaffold the bundled Cloudflare Worker into your project, so the fetch proxy is
**yours** — useful when you build from a VPS or any datacenter IP and don't want to depend on the
shared public proxy (its traffic is shared with every user of the package):

```sh
npx astro-substack proxy               # creates worker-proxy/worker.mjs + wrangler.jsonc
cd worker-proxy && npx wrangler deploy # ships it; wrangler prints the URL
```

The worker only forwards `https://*.substack.com` URLs (not an open proxy). Point
`SUBSTACK_PROXY_URL` — or the code option `proxy: "own"` + `proxyBaseUrl` — at the deployed URL.
See `examples/static-own-proxy` for a full working setup, and `examples/static-shared-proxy` for
the shared-proxy variant of the same example.

### CI / datacenter IPs

Substack's Cloudflare 403-challenges requests from datacenter IPs — GitHub Actions runners, most
CI — regardless of User-Agent, on both the archive endpoint and the RSS feed (verified 2026-09-30;
the same requests pass from residential IPs). If your prebuild fails with
`Substack archive returned HTTP 403`, route it through a fetch proxy. Two ways:

**Public proxy (zero setup).** The package ships a shared public proxy, deployed from
`examples/worker-proxy` at `https://astro-substack-proxy.fadlank.web.id`. In code, pass
`proxy: "public"`; in the prebuild, point `SUBSTACK_PROXY_URL` at it:

```sh
SUBSTACK_PROXY_URL=https://astro-substack-proxy.fadlank.web.id
```

It only proxies `https://*.substack.com` URLs (not an open proxy), and it runs on a custom domain,
so the `workers.dev` rate-limit caveat below does not apply to it. It is shared by everyone using
this package, though — prefer your own worker for serious CI usage.

**Own proxy.** Scaffold the worker into your project with the CLI, deploy it, and pass its URL —
in code via `proxy: "own"` + `proxyBaseUrl`, or in the prebuild via `SUBSTACK_PROXY_URL`:

```sh
npx astro-substack proxy           # creates worker-proxy/worker.mjs + wrangler.jsonc
cd worker-proxy && npx wrangler deploy
# → https://astro-substack-proxy.<your-subdomain>.workers.dev
```

The same worker also ships as `examples/worker-proxy`.

```sh
SUBSTACK_PROXY_URL=https://astro-substack-proxy.<your-subdomain>.workers.dev
```

The worker only proxies `https://*.substack.com` URLs, so it is not an open proxy. Publications
on custom domains are not proxied by the bundled worker.

> **workers.dev caveat:** on the free plan, `*.workers.dev` is edge-rate-limited per client IP,
> and shared CI runner IPs (GitHub Actions) routinely exhaust that budget — the same worker URL
> returned 200 from a residential IP and an instant 429 from a runner (verified 2026-09-30).
> For CI, prefer serving the proxy from a `pages.dev` Pages Function instead — see the
> `functions/` directory in `examples/static-shared-proxy`.

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
