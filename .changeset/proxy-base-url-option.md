---
"astro-substack": minor
---

Add `proxyBaseUrl` option: routes the archive request through a fetch proxy (`<proxyBaseUrl>?url=<encoded upstream>`) for environments where Substack's Cloudflare returns 403 to direct requests from datacenter IPs — GitHub Actions runners and other CI (verified 2026-09-30; a browser User-Agent alone does not pass, and the RSS feed is blocked the same way). Retryable failures (HTTP 429/503, network errors) are retried with linear backoff honoring Retry-After, tunable via `retryDelayMs` (base 5s): Substack rate-limits shared proxy egress IPs and a transient 429 must not fail an otherwise-green build. Ships with a deployable Cloudflare Worker proxy under examples/worker-proxy and SUBSTACK_PROXY_URL support in the prebuild template.
