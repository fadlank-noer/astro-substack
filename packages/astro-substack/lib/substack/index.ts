import { errorMessage, mapPost, normalizeHandle } from "./helper.ts";
import { findFeedItemContent, parseFeedItems } from "./feed.ts";
import { BROWSER_USER_AGENT, PUBLIC_PROXY_BASE_URL } from "../../types/index.ts";
import type {
  FetchPublicationsOptions,
  FeedSubstackPostContent,
  StaticPostsData,
  StaticPostsMetadata,
  SubstackPublicationPost,
} from "../../types/index.ts";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

/**
 * Proxy resolution shared by every fetchPublications():
 *
 * - `proxy: "public"` wins and routes through PUBLIC_PROXY_BASE_URL —
 *   `proxyBaseUrl` is ignored in that mode.
 * - `proxy: "own"` requires `proxyBaseUrl`; a missing URL fails loudly here
 *   instead of silently sending an unproxied request that Cloudflare will
 *   403 from CI.
 * - Otherwise a directly-set `proxyBaseUrl` keeps its original meaning.
 */
function resolveProxyBaseUrl(options: FetchPublicationsOptions): string | undefined {
  const { proxy, proxyBaseUrl } = options;
  if (proxy === "public") return PUBLIC_PROXY_BASE_URL;
  if (proxy === "own") {
    if (!proxyBaseUrl) {
      throw new RangeError(
        'proxy: "own" requires proxyBaseUrl — set it to your own proxy URL, or use proxy: "public" for the shared one',
      );
    }
    return proxyBaseUrl;
  }
  return proxyBaseUrl;
}

/**
 * Minimal, dependency-free client for reading PUBLIC Substack publications.
 *
 * Designed for client-side SPAs: it only uses the global `fetch` API.
 *
 * CORS caveat (verified 2026-09-21): Substack does NOT send
 * `Access-Control-Allow-Origin` on /api/v1/archive, so a browser on another
 * origin will block the response. When used in a browser SPA, route requests
 * through a same-origin proxy (or a worker) that forwards to Substack. The
 * logic here stays the same either way.
 */
export class SubstackInitiator {
  // protected: StaticSubstackInitiator persists the handle into posts.json meta.
  protected handle: string; // example: "https://fadlansthought.substack.com/"

  constructor(handle: string) {
    this.handle = handle;
  }

  /**
   * Fetch the public posts of the publication from the unofficial archive
   * endpoint: `{handle}/api/v1/archive?sort=<sort>&offset=0&limit=<limit>`.
   *
   * The `limit` param (1-50, server-side max) is only sent when set via
   * options; without it Substack returns every post of the publication.
   * An invalid `limit` falls back to the server-side max of 50.
   */
  async fetchPublications(options: FetchPublicationsOptions = {}): Promise<SubstackPublicationPost[]> {
    let { limit, sort = "new", timeoutMs = 15_000 } = options;

    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || limit < 1 || limit > 50)
    ) {
      limit = 50;
    }

    const archiveUrl = new URL("/api/v1/archive", normalizeHandle(this.handle));
    archiveUrl.searchParams.set("sort", sort);
    archiveUrl.searchParams.set("offset", "0");
    if (limit !== undefined) {
      archiveUrl.searchParams.set("limit", String(limit));
    }

    // Through the proxy, the upstream URL travels as the `url` query param and
    // the proxy returns the upstream response verbatim.
    const proxyBaseUrl = resolveProxyBaseUrl(options);
    const requestUrl: URL | string = proxyBaseUrl
      ? `${proxyBaseUrl}${proxyBaseUrl.includes("?") ? "&" : "?"}url=${encodeURIComponent(archiveUrl.toString())}`
      : archiveUrl;

    const { retryDelayMs = 10_000 } = options;
    const response = await this.fetchWithRetry(
      requestUrl,
      {
        Accept: "application/json",
        "User-Agent": BROWSER_USER_AGENT,
      },
      { timeoutMs, retryDelayMs, label: "Substack archive", sourceUrl: archiveUrl },
    );

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new TypeError(
        `Expected a JSON array from the Substack archive, got: ${typeof payload}`,
      );
    }

    return payload.map(mapPost);
  }

  /**
   * Issues `requestUrl` with `headers` and retries transient failures —
   * network errors, HTTP 429 and HTTP 503 — across 5 attempts with linear
   * backoff, honoring `Retry-After` when present: Substack rate-limits the
   * shared proxy egress IPs, and a transient 429 must not fail an
   * otherwise-green build. Throws when the request cannot be completed or
   * the final response is an HTTP error.
   */
  protected async fetchWithRetry(
    requestUrl: URL | string,
    headers: Record<string, string>,
    fetchOptions: { timeoutMs: number; retryDelayMs: number; label: string; sourceUrl: URL },
  ): Promise<Response> {
    const { timeoutMs, retryDelayMs, label, sourceUrl } = fetchOptions;
    const MAX_ATTEMPTS = 5;

    let response: Response | undefined;
    let lastCause: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        response = await fetch(requestUrl, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        lastCause = cause;
      }
      const retryable = !response || response.status === 429 || response.status === 503;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const retryAfter = Number(response?.headers.get("Retry-After"));
      const delayMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : retryDelayMs * attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      response = undefined;
    }

    if (!response) {
      throw new Error(
        `Failed to reach ${label} at ${sourceUrl}: ${errorMessage(lastCause)}`,
        { cause: lastCause },
      );
    }

    if (!response.ok) {
      throw new Error(
        `${label} returned HTTP ${response.status} ${response.statusText} for ${sourceUrl}`,
      );
    }

    return response;
  }
}

/**
 * Extended client for static builds that saves fetched posts to a local JSON file.
 * Use this for prebuild scripts — call `save()` before reading with `load()`.
 *
 * @example
 * ```typescript
 * const client = new StaticSubstackInitiator("https://yourpub.substack.com/", "/path/to/project");
 * await client.save({ limit: 20, sort: "new" });
 * const { meta, posts } = await client.load();
 * ```
 */
export class StaticSubstackInitiator extends SubstackInitiator {
  private dirPath: string;

  constructor(handle: string, dirPath: string) {
    super(handle);
    this.dirPath = dirPath;
  }

  /**
   * Fetches publications and saves them to __substack_rendered/posts.json.
   * Use this in prebuild scripts before static generation.
   */
  async saveStaticPosts(options: FetchPublicationsOptions = {}): Promise<void> {
    const posts = await this.fetchPublications(options);

    const outputDir = join(this.dirPath, "__substack_rendered");
    await mkdir(outputDir, { recursive: true });

    const payload = {
      version: 1,
      handle: this.handle,
      fetchedAt: new Date().toISOString(),
      sort: options.sort ?? "new",
      limit: options.limit ?? null,
      posts,
    };

    const outputPath = join(outputDir, "posts.json");
    const encoder = new TextEncoder();
    await writeFile(outputPath, encoder.encode(JSON.stringify(payload, null, 2)));
  }

  /**
   * Loads statically-rendered posts from __substack_rendered/posts.json.
   * Use this in Astro frontmatter for static pages.
   */
  async loadStaticPosts(): Promise<StaticPostsData> {
    const postsPath = join(this.dirPath, "__substack_rendered", "posts.json");

    let raw: string;
    try {
      raw = await readFile(postsPath, { encoding: "utf-8" });
    } catch (cause) {
      throw new Error(
        `Failed to read static posts from ${postsPath}: ${errorMessage(cause)}`,
        { cause },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new Error(
        `Malformed JSON in ${postsPath}: ${errorMessage(cause)}`,
        { cause },
      );
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("posts" in parsed) ||
      !Array.isArray(parsed.posts)
    ) {
      throw new TypeError(
        `Invalid static posts format in ${postsPath}: expected { version, fetchedAt, sort, limit, posts } structure`,
      );
    }

    const data = parsed as Record<string, unknown>;

    const version = typeof data.version === "number" ? data.version : 1;
    if (version > 1) {
      throw new TypeError(
        `Unsupported static posts schema version: ${version}. Expected 1. Update astro-substack package.`,
      );
    }

    return {
      meta: {
        version,
        handle: typeof data.handle === "string" ? data.handle : "",
        fetchedAt: typeof data.fetchedAt === "string" ? data.fetchedAt : "",
        sort: typeof data.sort === "string" ? data.sort : "new",
        limit: data.limit !== undefined && data.limit !== null ? Number(data.limit) : null,
      },
      posts: Array.isArray(data.posts) ? data.posts : [],
    };
  }
}

/**
 * Extended client that reads the publication's PUBLIC RSS feed
 * (`{handle}/feed`) instead of the unofficial archive API, implemented on
 * top of the same retry/proxy/User-Agent transport as the archive client.
 *
 * `fetchPublications()` returns the SAME lean shape as the archive client —
 * the list carries no content. The feed's two extra fields (the FULL post
 * body from `content:encoded` and the `dc:creator` byline) are fetched per
 * post via `fetchPostContent()`. The feed exposes no numeric post id
 * (`id` is always `0`; key on `canonicalUrl`/`slug`), audience/paywall, or
 * post type (mapped to the archive mapper's defaults).
 *
 * The feed has no pagination or sort parameters and is a snapshot of recent
 * posts only, never the full archive (verified 2026-09-30). `limit` is
 * therefore applied client-side after parsing, and `sort` is accepted for
 * signature compatibility but has no effect.
 */
export class FeedSubstackInitiator extends SubstackInitiator {
  async fetchPublications(options: FetchPublicationsOptions = {}): Promise<SubstackPublicationPost[]> {
    const { limit } = options;
    const posts = parseFeedItems(await this.fetchFeedDocument(options));
    if (limit !== undefined && Number.isInteger(limit) && limit >= 1) {
      return posts.slice(0, limit);
    }
    return posts;
  }

  /**
   * Fetch the FULL content of one post — exactly what the lean
   * `fetchPublications()` list leaves out (bodyHtml, author).
   *
   * The feed is the only public source of full post bodies and RSS has no
   * per-post endpoint, so this re-reads `{handle}/feed` through the same
   * retry/proxy transport and matches the item on canonicalUrl or slug.
   * Returns null when the feed holds no such post; `bodyHtml` is null when
   * the item carries no `content:encoded`. Each call costs one feed fetch —
   * cache the result when you need content for many posts.
   *
   * @param key the post's canonicalUrl, or just its slug.
   */
  async fetchPostContent(
    key: string,
    options: Pick<
      FetchPublicationsOptions,
      "proxy" | "proxyBaseUrl" | "retryDelayMs" | "timeoutMs"
    > = {},
  ): Promise<FeedSubstackPostContent | null> {
    const xml = await this.fetchFeedDocument(options);
    return findFeedItemContent(xml, key);
  }

  /** Fetches the raw feed XML through the shared retry/proxy transport. */
  private async fetchFeedDocument(
    options: Pick<
      FetchPublicationsOptions,
      "proxy" | "proxyBaseUrl" | "retryDelayMs" | "timeoutMs"
    >,
  ): Promise<string> {
    const { timeoutMs = 15_000, retryDelayMs = 10_000 } = options;

    const feedUrl = new URL("/feed", normalizeHandle(this.handle));

    // Through the proxy, the upstream URL travels as the `url` query param and
    // the proxy returns the upstream response verbatim.
    const proxyBaseUrl = resolveProxyBaseUrl(options);
    const requestUrl: URL | string = proxyBaseUrl
      ? `${proxyBaseUrl}${proxyBaseUrl.includes("?") ? "&" : "?"}url=${encodeURIComponent(feedUrl.toString())}`
      : feedUrl;

    const response = await this.fetchWithRetry(
      requestUrl,
      {
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7",
        "User-Agent": BROWSER_USER_AGENT,
      },
      { timeoutMs, retryDelayMs, label: "Substack RSS feed", sourceUrl: feedUrl },
    );
    return response.text();
  }
}
