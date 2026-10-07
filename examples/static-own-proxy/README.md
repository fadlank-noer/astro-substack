# Static example — own proxy

Same static prebuild flow as `examples/static-shared-proxy`, but the fetch is
routed through **your own proxy worker** instead of the shared public one.

## Why an own proxy exists

Substack's Cloudflare 403-challenges requests from datacenter IPs. GitHub
Actions runners and CI hit that challenge constantly, which is why the shared
public proxy (`examples/static-shared-proxy`) exists. But people also build
Astro sites from **their own VPS or server** — and a VPS IP is a datacenter IP
too, so direct fetches fail there as well. If you don't want to depend on the
shared proxy (its traffic is shared with every user of this package), deploy
your own worker and point this example at it.

## Setup

1. Scaffold the proxy worker into your project:

   ```sh
   npx astro-substack proxy
   ```

   This creates `worker-proxy/worker.mjs` + `worker-proxy/wrangler.jsonc`
   (the same worker as `examples/worker-proxy`: it only forwards
   `https://*.substack.com` URLs, so it is not an open proxy).

2. Deploy it (requires a free Cloudflare account):

   ```sh
   cd worker-proxy && npx wrangler deploy
   ```

   Wrangler prints the URL, e.g. `https://astro-substack-proxy.<your-subdomain>.workers.dev`.

3. Point the prebuild at YOUR proxy:

   ```sh
   cp .env.example .env   # then set SUBSTACK_PROXY_URL to the URL from step 2
   ```

4. Build:

   ```sh
   pnpm install           # from the repo root, once
   pnpm --filter static-own-proxy build
   ```

## Shared vs own

| | `static-shared-proxy` | `static-own-proxy` (this example) |
| --- | --- | --- |
| Proxy | Shared public proxy (`astro-substack-proxy.fadlank.web.id`) | Your own deployed worker |
| Setup | None (URL preset in `.env.example`) | `npx astro-substack proxy` + one deploy |
| Traffic | Shared with every user of the package | Only yours — full control, no shared rate budget |

The prebuild script itself is identical in both examples (env-driven; the
proxy is just `SUBSTACK_PROXY_URL`).
