import type { SubstackPublicationPost } from "./index.ts";

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

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
