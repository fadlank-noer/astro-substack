// Pages Function: same ?url= proxy contract as examples/worker-proxy/worker.mjs,
// but served from the pages.dev domain. The chain CI workflow routes its
// archive fetches here because workers.dev free-plan rate limiting 429s
// GitHub Actions runner IPs at the edge (verified 2026-09-30: the same worker
// URL returned 200 from a residential IP and an instant 429 from a runner).
// Restricted to https://*.substack.com so it is not an open proxy.
const ALLOWED_SUFFIX = ".substack.com";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export async function onRequestGet({ request }) {
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
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(ALLOWED_SUFFIX)) {
    return text(403, "Only https://*.substack.com URLs are proxied");
  }

  const upstream = await fetch(parsed, {
    headers: {
      Accept: "application/json, application/xml, text/xml, */*",
      "User-Agent": USER_AGENT,
    },
    redirect: "follow",
    // Posts change rarely; keep upstream hits low on the free tier.
    cf: { cacheTtl: 300, cacheEverything: true },
  });

  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("Content-Type") ?? "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=300");
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(upstream.body, { status: upstream.status, headers });
}

function text(status, message) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
