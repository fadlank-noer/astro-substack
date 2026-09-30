---
"astro-substack": patch
---

Send a browser User-Agent on archive fetches: Substack's Cloudflare returns 403 to requests without a browser User-Agent when they originate from a datacenter IP (e.g. GitHub Actions runners), which broke static-build prebuilds in CI. Residential IPs were unaffected.
