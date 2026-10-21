import type { SubstackPostContent, SubstackPublicationPost } from "../../types/index.ts";

export function normalizeHandle(handle: string): string {
  const trimmed = handle.trim();
  if (trimmed.length === 0) {
    throw new RangeError("handle must be a non-empty Substack URL");
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function mapPost(raw: unknown): SubstackPublicationPost {
  if (typeof raw !== "object" || raw === null) {
    throw new TypeError("Archive entry is not an object");
  }
  const record = raw as Record<string, unknown>;
  const audience =
    typeof record.audience === "string" ? record.audience : "everyone";

  return {
    id: Number(record.id),
    title: typeof record.title === "string" ? record.title : "",
    subtitle: typeof record.subtitle === "string" ? record.subtitle : null,
    slug: typeof record.slug === "string" ? record.slug : "",
    postDate: typeof record.post_date === "string" ? record.post_date : "",
    canonicalUrl:
      typeof record.canonical_url === "string" ? record.canonical_url : "",
    coverImage:
      typeof record.cover_image === "string" ? record.cover_image : null,
    audience,
    isPaywalled: audience === "paid" || Boolean(record.is_paid),
    type: typeof record.type === "string" ? record.type : "newsletter",
  };
}

/** Extract the slug from a `/p/<slug>` URL, or pass a bare slug through. */
export function extractSlug(key: string): string {
  try {
    return new URL(key).pathname.replace(/^\/p\//, "").replace(/\/$/, "");
  } catch {
    return key;
  }
}

/**
 * Map one raw response of GET {handle}/api/v1/posts/{slug} (top-level post
 * object — NOT the `{post: …}` wrapper of the global by-id endpoint) to
 * SubstackPostContent. Missing/garbled fields fall back like mapPost does.
 */
export function mapPostContent(raw: unknown): SubstackPostContent {
  if (typeof raw !== "object" || raw === null) {
    throw new TypeError("Post content response is not an object");
  }
  const record = raw as Record<string, unknown>;
  const bylines = Array.isArray(record.publishedBylines)
    ? record.publishedBylines
    : [];
  const first = bylines[0] as Record<string, unknown> | undefined;
  const audience =
    typeof record.audience === "string" ? record.audience : "everyone";

  return {
    title: typeof record.title === "string" ? record.title : "",
    subtitle: typeof record.subtitle === "string" ? record.subtitle : null,
    postDate: typeof record.post_date === "string" ? record.post_date : "",
    canonicalUrl:
      typeof record.canonical_url === "string" ? record.canonical_url : "",
    slug: typeof record.slug === "string" ? record.slug : "",
    author: first && typeof first.name === "string" ? first.name : null,
    coverImage:
      typeof record.cover_image === "string" ? record.cover_image : null,
    audience,
    isPaywalled: audience === "paid",
    type: typeof record.type === "string" ? record.type : "newsletter",
    bodyHtml: typeof record.body_html === "string" ? record.body_html : null,
  };
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
