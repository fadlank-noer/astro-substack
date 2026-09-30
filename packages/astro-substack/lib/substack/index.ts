/**
 * Sorting options supported by the Substack archive endpoint.
 */
export type SubstackSort = "new" | "top" | "pinned" | "community";

import { errorMessage, mapPost, normalizeHandle } from "./helper.ts";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

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
   * Base URL of a fetch proxy (see examples/worker-proxy) for environments
   * where Substack's Cloudflare 403-challenges direct requests — GitHub
   * Actions runners and other datacenter IPs (verified 2026-09-30: both the
   * archive and the RSS feed are blocked there regardless of User-Agent,
   * while the same requests pass from residential IPs). When set, the request
   * goes to `<proxyBaseUrl>?url=<encoded archive URL>` and the proxy must
   * return the upstream response verbatim.
   */
  proxyBaseUrl?: string;
  /**
   * Base delay between retries of retryable failures (HTTP 429/503 and
   * network errors), multiplied by the attempt number: 5s, 10s by default.
   * Substack rate-limits the shared proxy egress IPs, so a build that waits
   * out a transient 429 succeeds instead of failing the whole deploy.
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
 * Substack serves /api/v1/archive behind Cloudflare, which 403s non-browser
 * clients when the request originates from a datacenter IP (seen 2026-09-30:
 * GitHub Actions runners got "HTTP 403 Forbidden" while the same request from
 * a residential IP passed). Sending a browser User-Agent satisfies the bot
 * rule; Node's own default UA (or none) does not.
 */
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

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
    let { limit, sort = "new", timeoutMs = 15_000, proxyBaseUrl } = options;

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
    const requestUrl: URL | string = proxyBaseUrl
      ? `${proxyBaseUrl}${proxyBaseUrl.includes("?") ? "&" : "?"}url=${encodeURIComponent(archiveUrl.toString())}`
      : archiveUrl;

    const { retryDelayMs = 5_000 } = options;
    const MAX_ATTEMPTS = 3;

    // 429/503 and network errors are retried with linear backoff (honoring
    // Retry-After when present): Substack rate-limits the shared proxy egress
    // IPs, and a transient 429 must not fail an otherwise-green build.
    let response: Response | undefined;
    let lastCause: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        response = await fetch(requestUrl, {
          headers: {
            Accept: "application/json",
            "User-Agent": BROWSER_USER_AGENT,
          },
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
        `Failed to reach Substack archive at ${archiveUrl}: ${errorMessage(lastCause)}`,
        { cause: lastCause },
      );
    }

    if (!response.ok) {
      throw new Error(
        `Substack archive returned HTTP ${response.status} ${response.statusText} for ${archiveUrl}`,
      );
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new TypeError(
        `Expected a JSON array from the Substack archive, got: ${typeof payload}`,
      );
    }

    return payload.map(mapPost);
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
