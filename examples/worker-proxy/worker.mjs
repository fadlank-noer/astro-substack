// Minimal fetch proxy for environments where Substack's Cloudflare
// 403-challenges direct requests from datacenter IPs — GitHub Actions runners
// and most CI (verified 2026-09-30; a browser User-Agent does not help, and
// the RSS feed is blocked the same way, while the same requests pass from
// residential IPs).
//
// Usage:  https://<worker>/?url=<url-encoded absolute URL on *.substack.com>
// Contract: returns the upstream response verbatim (status + Content-Type),
// which is what astro-substack's `proxyBaseUrl` option expects.
//
// Restricted to https://*.substack.com so it is not an open proxy.

const ALLOWED_SUFFIX = ".substack.com";

// Matches the browser UA astro-substack sends on direct requests.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export default {
  async fetch(request) {
    const target = new URL(request.url).searchParams.get("url");
    if (!target) {
      return text(400, "Missing ?url=<url-encoded substack URL>");
    }

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return text(400, "Invalid url");
    }
    if (
      parsed.protocol !== "https:" ||
      !(parsed.hostname === `www${ALLOWED_SUFFIX}` || parsed.hostname.endsWith(ALLOWED_SUFFIX))
    ) {
      return text(403, "Only https://*.substack.com URLs are proxied");
    }

    const upstream = await fetch(parsed, {
      headers: {
        Accept: "application/json, application/xml, text/xml, */*",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
    });

    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("Content-Type") ?? "application/octet-stream");
    headers.set("Cache-Control", "public, max-age=300");
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function text(status, message) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
