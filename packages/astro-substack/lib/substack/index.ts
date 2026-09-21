/**
 * Sorting options supported by the Substack archive endpoint.
 */
export type SubstackSort = "new" | "top" | "pinned" | "community";

import { errorMessage, mapPost, normalizeHandle } from "./helper.ts";

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
  /** Canonical URL of the post on Substack. */
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
  private handle: string; // example: "https://fadlansthought.substack.com/"

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

    const url = new URL("/api/v1/archive", normalizeHandle(this.handle));
    url.searchParams.set("sort", sort);
    url.searchParams.set("offset", "0");
    if (limit !== undefined) {
      url.searchParams.set("limit", String(limit));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new Error(
        `Failed to reach Substack archive at ${url}: ${errorMessage(cause)}`,
        { cause },
      );
    }

    if (!response.ok) {
      throw new Error(
        `Substack archive returned HTTP ${response.status} ${response.statusText} for ${url}`,
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
