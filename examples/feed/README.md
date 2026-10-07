# Feed example

Two-stage demo of the publication's **public RSS feed** (`{handle}/feed`) with
`FeedSubstackInitiator`:

1. **List page (`src/pages/index.astro`)** — `fetchPublications()` returns the same
   lean shape as the archive client (`SubstackPublicationPost[]`): title, subtitle,
   date, links. **No content is fetched here.**
2. **Detail pages (`src/pages/posts/[slug].astro`)** — per post,
   `fetchPostContent(canonicalUrl)` — a **separate function** — re-reads the feed and
   returns the full post body (`bodyHtml`, from `content:encoded`) plus the author
   byline. RSS has no per-post endpoint, so each content call costs one feed fetch;
   cache it when you need content for many posts.

The feed's XML is parsed with [fast-xml-parser](https://www.npmjs.com/package/fast-xml-parser),
the package's only runtime dependency.

## Run

```sh
pnpm install            # from the repo root, once
pnpm --filter feed dev  # or: pnpm --filter feed build
```

## Options demonstrated

Every option of `FeedSubstackInitiator.fetchPublications()` / `fetchPostContent()` (see
`packages/astro-substack/lib/substack/index.ts`) is exercised in the pages:

| Option | Feed behavior |
| --- | --- |
| `limit` | List only — applied client-side (the feed has no pagination); invalid values are ignored. |
| `timeoutMs` | Per-attempt request timeout (default 15s). |
| `retryDelayMs` | Linear backoff base for HTTP 429/503 retries (5 attempts: 10s, 20s, 30s, 40s). |
| `proxy` | `"public"` = the shared public proxy (`https://astro-substack-proxy.fadlank.web.id`, zero setup); `"own"` = your `proxyBaseUrl` (required, else `RangeError`). |
| `proxyBaseUrl` | Your own fetch proxy — needed on CI/datacenter IPs, where Substack's Cloudflare 403-challenges direct requests. See `examples/worker-proxy`. |
| `sort` | No effect — the feed is always newest-first; accepted for signature compatibility. |

## Environment (all optional — copy `.env.example` to `.env`)

| Variable | Meaning |
| --- | --- |
| `SUBSTACK_PUBLICATION_URL` | Publication to fetch. Defaults to `https://fadlansthought.substack.com/`. |
| `SUBSTACK_PROXY_URL` | Fetch proxy base URL for CI/datacenter environments. |

## Deploy to Cloudflare Workers (static)

`wrangler.jsonc` ships an **assets-only** Worker config: the RSS fetch happens at build
time, and Cloudflare serves the prebuilt `dist/` — no server-side code runs per request.

```sh
# one-time login
npx wrangler login

# build + deploy (deploys dist/ as static assets)
pnpm --filter feed run deploy
```

> [!NOTE]
> Use `run deploy`, not bare `pnpm --filter feed deploy` — `deploy` is a built-in pnpm
> command, so without `run` you get `ERR_PNPM_INVALID_DEPLOY_TARGET` instead of the script.

**Live:** the reference deployment runs at
[https://astro-substack-feed-example.fadlank-noer.workers.dev](https://astro-substack-feed-example.fadlank-noer.workers.dev).

## GitHub CI/CD: fetch, CORS, and the Cloudflare challenge

`.github/workflows/feed-example-deploy.yml` deploys the example on every push to `main`
touching the package or the example. Two things to know about fetching from CI:

1. **CORS is a non-issue here.** The fetch runs at **build time** (Node, in the Astro
   frontmatter) — never in the visitor's browser. The deployed site is plain prebuilt HTML,
   so visitors' browsers never talk to Substack at all. CORS would only matter for
   client-side runtime fetching (Substack sends no `Access-Control-Allow-Origin`).
2. **The real CI problem is the Cloudflare 403 challenge, not CORS.** Substack's
   Cloudflare challenges direct requests from datacenter IPs — GitHub Actions runners get
   HTTP 403 on both the archive and the RSS feed regardless of User-Agent (verified
   2026-09-30 in `archive-probe.yml`). The workflow therefore sets:

   ```yaml
   SUBSTACK_PROXY_URL: https://astro-substack-proxy.fadlank.web.id   # shared public proxy
   ```

   Route through **your own worker** instead (`npx astro-substack proxy`, then deploy
   `worker-proxy/`) if you don't want to share the public proxy's traffic — same story as
   `examples/static-own-proxy`. Transient upstream 429s (Substack rate-limits shared proxy
   egress IPs) are already retried by the client with linear backoff.

**Required repo secrets:** `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit), `CLOUDFLARE_ACCOUNT_ID`.
**Optional repo variable:** `SUBSTACK_PUBLICATION_URL` (empty/unset → falls back to the default
publication). Alternatively deploy by hand: `pnpm --filter feed deploy`.
