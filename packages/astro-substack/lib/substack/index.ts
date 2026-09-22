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
}

export interface StaticPostsMetadata {
  /** Schema version — increment on breaking format changes. */
  version: number;
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
        fetchedAt: typeof data.fetchedAt === "string" ? data.fetchedAt : "",
        sort: typeof data.sort === "string" ? data.sort : "new",
        limit: data.limit !== undefined && data.limit !== null ? Number(data.limit) : null,
      },
      posts: Array.isArray(data.posts) ? data.posts : [],
    };
  }
}
