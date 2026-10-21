<div align="center">
  <img src="https://raw.githubusercontent.com/fadlank-noer/astro-substack/039685fb14bdc1703b9872f675461503dceb6ed8/assets/logo.png" alt="Astro Substack logo" width="180" />
  <h1>Astro Substack</h1>
  <p><strong>3 paths · 1 library</strong> — fetch public posts from any Substack publication in Astro.</p>
</div>

<div align="center">
  <img src="https://github.com/fadlank-noer/astro-substack/blob/039685fb14bdc1703b9872f675461503dceb6ed8/assets/lib-journey.png?raw=true" alt="Astro Substack journey: SubstackInitiator (SSR · live fetch), FeedSubstackInitiator (RSS · full body HTML), StaticSubstackInitiator (Build-time · posts.json)" width="880" />
</div>

<div align="center">
  <a href="https://www.npmjs.com/package/astro-substack">
    <img src="https://img.shields.io/npm/v/astro-substack.svg" alt="npm version" />
  </a>
  <a href="https://www.npmjs.com/package/astro-substack">
    <img src="https://img.shields.io/npm/dm/astro-substack.svg" alt="npm downloads" />
  </a>
  <a href="https://github.com/fadlank-noer/astro-substack/releases">
    <img src="https://img.shields.io/github/v/release/fadlank-noer/astro-substack?label=release" alt="GitHub release" />
  </a>
</div>

> [!WARNING]
> **Experimental Package** — under active development; breaking changes may happen between versions.

## Install

```sh
npm install astro-substack
```

One runtime dependency ([fast-xml-parser](https://www.npmjs.com/package/fast-xml-parser), used to parse the RSS feed). All three initiators are exported from the package root and accept a full URL, a custom domain, or a bare handle (`yourpub`).

---

## Path 1 — `SubstackInitiator()` · SSR · live fetch

Minimal client for **public** posts via the archive endpoint, mapped to a clean typed shape.

```ts
import { SubstackInitiator } from "astro-substack";

const client = new SubstackInitiator("https://yourpub.substack.com/");
const posts = await client.fetchPublications({ limit: 10, sort: "new" });
```

```astro
---
import { SubstackInitiator } from "astro-substack";

const posts = await new SubstackInitiator("https://yourpub.substack.com/").fetchPublications();
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

Options:

| Option                  | Default   | Notes                                                                              |
| ----------------------- | --------- | ---------------------------------------------------------------------------------- |
| `limit`                 | all posts | `1`–`50`; invalid values fall back to `50`                                          |
| `sort`                  | `"new"`   | `"new" \| "top" \| "pinned" \| "community"`                                          |
| `timeoutMs`             | `15000`   | per-request timeout                                                                 |
| `retryDelayMs`          | `10000`   | 5 attempts on network errors / 429 / 503, honors `Retry-After`                      |
| `proxy`, `proxyBaseUrl` | direct    | `"public"` (shared proxy) or `"own"` + `proxyBaseUrl` — see [Proxy](#proxy)          |

Each post returns `id`, `title`, `subtitle`, `slug`, `postDate`, `canonicalUrl`, `coverImage`, `audience`, `isPaywalled`, `type` — **metadata only**.

### Full post body — `fetchPostContent(key, options?)`

The list carries no bodies. Fetch one post's full content from the publication's public `{handle}/api/v1/posts/{slug}` endpoint (no auth; verified to return the top-level post object with `body_html` and to pass through the proxy):

```ts
import { SubstackInitiator } from "astro-substack";

const client = new SubstackInitiator("https://yourpub.substack.com/");

// key = the post's canonicalUrl or just its slug
const post = await client.fetchPostContent("are-you-tone-deaf-for-practicing");
// → SubstackPostContent | null
//   { title, subtitle, postDate, canonicalUrl, slug, author, coverImage,
//     audience, isPaywalled, type, bodyHtml }
```

- Returns `null` on HTTP 404 (no such post); honors the same `proxy` / `proxyBaseUrl` / `timeoutMs` / `retryDelayMs` options as the list — **a proxy is required on CI**, the endpoint sits behind the same Cloudflare rules as the archive.
- `bodyHtml` is raw first-party HTML. Rendering it with Astro's `set:html` bypasses sanitizers **by design** — only point this client at publications you trust.
- Each call is one request; fan out sequentially if you fetch many posts (the shared proxy rate-limits bursts).

```astro
---
import { SubstackInitiator } from "astro-substack";

const content = await new SubstackInitiator("https://yourpub.substack.com/")
  .fetchPostContent(Astro.params.slug, { proxyBaseUrl: import.meta.env.SUBSTACK_PROXY_URL });
---
<article>
  <h1>{content.title}</h1>
  {content.isPaywalled && <p>🔒 Paid subscribers only — teaser</p>}
  {content.bodyHtml ? <div set:html={content.bodyHtml} /> : <p><em>(no content)</em></p>}
</article>
```

## Path 2 — `FeedSubstackInitiator()` · RSS · full body HTML

Reads the public RSS feed (`{handle}/feed`) — the only path with **full post bodies**.

```ts
import { FeedSubstackInitiator } from "astro-substack";

const client = new FeedSubstackInitiator("https://yourpub.substack.com/");

// 1. Lean list — same shape as Path 1
const posts = await client.fetchPublications({ limit: 10 });

// 2. Full content — a separate call; re-reads the feed and matches by
//    canonicalUrl or slug. Returns null when the feed holds no such post.
const post = await client.fetchPostContent("are-you-tone-deaf-for-practicing");
// → { title, subtitle, postDate, canonicalUrl, slug, author, bodyHtml }
```

Feed quirks vs Path 1: `id` is always `0`, `sort` is a no-op, `limit` is applied client-side, and the feed is a recent-posts **snapshot** — not the full archive. Each `fetchPostContent()` costs one feed fetch, so cache the result when you need content for many posts.

## Path 3 — `StaticSubstackInitiator()` · Build-time · posts.json

For static sites: fetch **once at build**, read from disk in your pages. The bundled CLI scaffolds everything:

```sh
npx astro-substack init --publication https://yourpub.substack.com/
```

This creates `scripts/prebuild.mjs` (env-driven; re-run with `--force` to overwrite) and prints the script block to paste:

```json
{
  "scripts": {
    "prebuild": "node scripts/prebuild.mjs",
    "build": "npm run prebuild && astro build"
  }
}
```

Configuration via env (or `.env` / `.env.local` — process env wins):

| Variable                   | Required | Meaning                                                       |
| -------------------------- | -------- | -------------------------------------------------------------- |
| `SUBSTACK_PUBLICATION_URL` | **yes**  | The publication to fetch; missing → the script exits           |
| `SUBSTACK_LIMIT`           | no       | `1`–`50`, out-of-range clamps to `50`                           |
| `SUBSTACK_SORT`            | no       | `"new"` (default) \| `"top"` \| `"pinned"` \| `"community"`      |
| `SUBSTACK_PROXY_URL`       | no       | Proxy base URL for CI — see [Proxy](#proxy)                     |
| `SUBSTACK_FETCH_CONTENT`   | no       | Set `0` to skip the per-post body fan-out (default: fetch)      |

The prebuild writes `__substack_rendered/posts.json` (add it to `.gitignore`). Pages read it back with `loadStaticPosts()` — the handle is stored in `meta.handle`, so pages need **no env access**. A failed fetch never leaves stale posts behind: the old file is removed before fetching.

```astro
---
import { StaticSubstackInitiator } from "astro-substack";

const { meta, posts } = await new StaticSubstackInitiator("unused", process.cwd()).loadStaticPosts();
---

<p>Publication: {meta.handle}</p>
<ul>
  {posts.map((post) => (
    <li>
      <a href={`/posts/${post.slug}/`}>{post.title}</a>
      <time datetime={post.postDate}>{new Date(post.postDate).toDateString()}</time>
    </li>
  ))}
</ul>
```

### Full post bodies — `saveAll()` / `saveStaticArticles()` / `loadStaticArticle()`

The scaffolded prebuild calls `saveAll()` — the chained fetch: the post list is fetched **once** into `__substack_rendered/posts.json`, then every post's **full body** goes into one file per post, `__substack_rendered/articles/<slug>.json` (add the folder to `.gitignore`). Calling `saveStaticPosts()` + `saveStaticArticles()` yourself chains identically — the article pass reads the posts.json just written, so list and bodies always come from ONE snapshot. Requests go out sequentially with a 300 ms pause (the shared proxy rate-limits bursts); set `SUBSTACK_FETCH_CONTENT=0` to skip the fan-out while iterating on layout.

Each file is a versioned envelope:

```json
{
  "version": 1,
  "handle": "https://yourpub.substack.com/",
  "fetchedAt": "2026-10-21T08:00:59.145Z",
  "slug": "are-you-tone-deaf-for-practicing",
  "content": { "title": "…", "bodyHtml": "<p>…</p>", "isPaywalled": false, "…": "…" }
}
```

A `content` of `null` is valid — it means Substack answered 404 for that slug mid-save; the file still loads. The articles directory is wiped before every run, so a failed build never leaves stale bodies behind. Detail pages enumerate slugs from `loadStaticPosts()` and read the body with `loadStaticArticle()`:

```astro
---
// src/pages/posts/[slug].astro
import { StaticSubstackInitiator } from "astro-substack";

export async function getStaticPaths() {
  // self-contained — Astro compiles getStaticPaths as a separate chunk
  const client = new StaticSubstackInitiator("unused", process.cwd());
  const { posts } = await client.loadStaticPosts();
  return posts
    .filter((post) => post.slug && !post.slug.includes("/") && !post.slug.startsWith("."))
    .map((post) => ({ params: { slug: post.slug } }));
}

const { slug } = Astro.params;
const article = await new StaticSubstackInitiator("unused", process.cwd()).loadStaticArticle(slug);
const content = article.content;
---

<article>
  <h1>{content?.title ?? slug}</h1>
  {content?.isPaywalled && <p>🔒 Paid subscribers only — teaser</p>}
  {content?.bodyHtml ? <div set:html={content.bodyHtml} /> : <p><em>(no content)</em></p>}
</article>
```

`loadStaticArticle()` throws when the file is missing or malformed — a missing file means the prebuild never ran, and failing loudly beats a blank page. As with the archive client, `set:html` renders first-party HTML without sanitizing: trust the publication.

---

## Proxy

Substack's Cloudflare 403-challenges requests from datacenter IPs (GitHub Actions, most CI) on **both** the archive endpoint and the feed. On CI, route through a fetch proxy with the contract `<proxyBaseUrl>?url=<encoded substack URL>`:

- **Shared public proxy (zero setup):** pass `proxy: "public"` in code, or set `SUBSTACK_PROXY_URL=https://astro-substack-proxy.fadlank.web.id`. Runs on a custom domain; shared with every user of this package.
- **Own proxy:** scaffold and deploy the bundled Cloudflare Worker, then point `proxy: "own"` + `proxyBaseUrl` (or `SUBSTACK_PROXY_URL`) at it:

  ```sh
  npx astro-substack proxy               # creates worker-proxy/worker.mjs + wrangler.jsonc
  cd worker-proxy && npx wrangler deploy # prints your worker URL
  ```

The worker only forwards `https://*.substack.com` URLs (not an open proxy); publications on custom domains are not proxied.

> **workers.dev caveat:** on the free plan, `*.workers.dev` is edge-rate-limited per client IP and shared CI runner IPs routinely exhaust that budget (instant 429). For CI, prefer a `pages.dev` Pages Function — see `functions/` in `examples/static-shared-proxy`.

Full working setups: `examples/ssr`, `examples/feed`, `examples/static-shared-proxy`, `examples/static-own-proxy`, `examples/worker-proxy`.

## Good to know

- **Server-side only.** Substack sends no CORS headers — call from Astro frontmatter, endpoints, or SSR, never from browser JavaScript.
- **Public data only.** No comments, notes, about pages, subscribers, or paywalled bodies; cover images are URLs.
- **Import from the package root** — `astro-substack/lib/*` deep imports no longer exist. The `<Hello />` demo component lives at `astro-substack/astro`: `import Hello from "astro-substack/astro";`.
- **CLI recap:** `npx astro-substack init` scaffolds the prebuild, `npx astro-substack proxy` scaffolds the proxy worker; both accept `--force`.

## Tests

```sh
pnpm test:unit              # from the workspace root (offline, stubbed fetch)
SUBSTACK_LIVE_TEST=1 node --test tests/substack-live.test.ts   # inside packages/astro-substack
```

## License

MIT
