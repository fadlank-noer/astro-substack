/**
 * Single source of truth for astro-substack's public types and constants.
 * The package root `index.ts` re-exports everything consumers need; classes
 * in `lib/substack/` import from here.
 */

/**
 * Sorting options supported by the Substack archive endpoint.
 */
export type SubstackSort = "new" | "top" | "pinned" | "community";

/**
 * A public publication post as returned by `SubstackInitiator.fetchPublications()`.
 */
export interface SubstackPublicationPost {
  /** Numeric post id from the Substack API. */
  id: number;
  /** Post title (plain text). */
  title: string;
  /** Post subtitle, or null when absent. */
  subtitle: string | null;
  /** URL slug, e.g. "are-you-tone-deaf-for-practicing". */
  slug: string;
  /** ISO 8601 publish timestamp, e.g. "2026-09-19T15:59:11.064Z". */
  postDate: string;
  /** Canonical URL of the post. */
  canonicalUrl: string;
  /** Cover image URL, or null when the post has no cover. */
  coverImage: string | null;
  /** Raw audience field from the API ("everyone", "paid", ...). */
  audience: string;
  /** True when the post is paywalled (audience "paid" or is_paid truthy). */
  isPaywalled: boolean;
  /** Raw post type from the API ("newsletter", "podcast", ...). */
  type: string;
}

/**
 * The full content of ONE post, fetched from the publication's public RSS
 * feed via `FeedSubstackInitiator.fetchPostContent()`. The lean
 * `fetchPublications()` list deliberately carries none of this — bodies are
 * fetched per post, separately.
 */
export interface FeedSubstackPostContent {
  /** Post title (plain text). */
  title: string;
  /** Post subtitle, or null when absent. */
  subtitle: string | null;
  /** ISO 8601 publish timestamp, or "" when the feed's date is unparseable. */
  postDate: string;
  /** Canonical URL of the post (the identity used to match the feed item). */
  canonicalUrl: string;
  /** URL slug, e.g. "are-you-tone-deaf-for-practicing". */
  slug: string;
  /** Post author from `<dc:creator>`, or null when the feed omits it. */
  author: string | null;
  /** Full post body HTML from `<content:encoded>`, or null when absent. */
  bodyHtml: string | null;
}

export interface FetchPublicationsOptions {
  /**
   * Maximum number of posts to request (1-50, server-side max).
   * When omitted, the request omits the `limit` param and Substack returns
   * ALL posts of the publication (verified live 2026-09-21).
   * An invalid value (non-integer, < 1, or > 50) falls back to 50.
   */
  limit?: number;
  /** Sort order of the archive. Default: "new". */
  sort?: SubstackSort;
  /** Request timeout in milliseconds. Default: 15000. */
  timeoutMs?: number;
  /**
   * Which fetch proxy to route the request through for environments where
   * Substack's Cloudflare 403-challenges direct requests (see proxyBaseUrl):
   * - `"public"` — the shared public proxy deployed from
   *   examples/worker-proxy (PUBLIC_PROXY_BASE_URL). Zero setup, but shared
   *   with every user of the package — prefer your own proxy for heavy CI
   *   usage. `proxyBaseUrl` is ignored in this mode.
   * - `"own"` — your own proxy at `proxyBaseUrl`, which is required in this
   *   mode; a missing URL throws a RangeError instead of silently sending
   *   an unproxied (CI-blocked) request.
   * Omitted: direct request, unless `proxyBaseUrl` is set directly.
   */
  proxy?: "own" | "public";
  /**
   * Base URL of a fetch proxy (see examples/worker-proxy) for environments
   * where Substack's Cloudflare 403-challenges direct requests — GitHub
   * Actions runners and other datacenter IPs (verified 2026-09-30: both the
   * archive and the RSS feed are blocked there regardless of User-Agent,
   * while the same requests pass from residential IPs). When set — or when
   * `proxy: "own"` is set — the request
   * goes to `<proxyBaseUrl>?url=<encoded archive URL>` and the proxy must
   * return the upstream response verbatim.
   */
  proxyBaseUrl?: string;
  /**
   * Base delay between retries of retryable failures (HTTP 429/503 and
   * network errors), multiplied by the attempt number: 10s, 20s, 30s, 40s by
   * default (5 attempts, ~100s of total backoff). Substack rate-limits the
   * shared proxy egress IPs, and those windows can outlast a few seconds —
   * a build that waits them out succeeds instead of failing the whole deploy.
   */
  retryDelayMs?: number;
}

export interface StaticPostsMetadata {
  /** Schema version — increment on breaking format changes. */
  version: number;
  /** Publication handle the posts were fetched from. Lets a page know the
   *  source without reading env, which differs between Node and Vite. */
  handle: string;
  /** ISO 8601 timestamp when posts were fetched. */
  fetchedAt: string;
  /** Sort order used: "new", "top", "pinned", or "community". */
  sort: string;
  /** Requested limit (null = all posts). */
  limit: number | null;
}

export interface StaticPostsData {
  meta: StaticPostsMetadata;
  posts: SubstackPublicationPost[];
}

/**
 * The shared public fetch proxy (deployed from examples/worker-proxy) used
 * by `proxy: "public"`. It only forwards https://*.substack.com URLs, so it
 * is not an open proxy.
 */
export const PUBLIC_PROXY_BASE_URL = "https://astro-substack-proxy.fadlank.web.id";

/**
 * Substack serves /api/v1/archive and /feed behind Cloudflare, which 403s
 * non-browser clients when the request originates from a datacenter IP (seen
 * 2026-09-30: GitHub Actions runners got "HTTP 403 Forbidden" for both while
 * the same requests from a residential IP passed). Sending a browser
 * User-Agent satisfies the bot rule; Node's own default UA (or none) does not.
 */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
