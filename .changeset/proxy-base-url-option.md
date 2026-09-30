---
"astro-substack": minor
---

Add `proxyBaseUrl` option: routes the archive request through a fetch proxy (`<proxyBaseUrl>?url=<encoded upstream>`) for environments where Substack's Cloudflare 403-challenges direct requests from datacenter IPs — GitHub Actions runners and other CI (verified 2026-09-30; a browser User-Agent alone does not pass, and the RSS feed is blocked the same way). Ships with a deployable Cloudflare Worker proxy under examples/worker-proxy and SUBSTACK_PROXY_URL support in the prebuild template.
