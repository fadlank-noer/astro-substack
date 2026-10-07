/**
 * RSS feed parsing for Substack's public feed (`{handle}/feed`), built on
 * `fast-xml-parser` (the package's only runtime dependency) so XML quirks —
 * entities, CDATA, attributes, namespaces — are handled by a maintained
 * library rather than hand-rolled regexes. It extracts the fields observed
 * in the feed (see `.brain-project/knowledge/substack-rss/` for the
 * 2026-09-30 snapshot) and falls back to empty/null like the archive mapper
 * does.
 */
import { XMLParser } from "fast-xml-parser";
import type {
  FeedSubstackPostContent,
  SubstackPublicationPost,
} from "../../types/index.ts";

const parser = new XMLParser({
  // We need `@_attr` access (enclosure url/type) and verbatim CDATA under
  // `__cdata` — entities inside CDATA belong to the embedded HTML (e.g.
  // content:encoded) and must NOT be decoded by the XML layer, while plain
  // text still gets entity-decoded (processEntities defaults to true).
  ignoreAttributes: false,
  cdataPropName: "__cdata",
  // Keep every value a string: a title of "42" must stay "42".
  parseTagValue: false,
  parseAttributeValue: false,
});

type ParsedNode = Record<string, unknown>;

/** The full record one feed item carries: the lean post plus its content. */
type ParsedFeedItem = SubstackPublicationPost & {
  author: string | null;
  bodyHtml: string | null;
};

function isParsedNode(value: unknown): value is ParsedNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Text of a parsed node: a plain string, CDATA content (under `__cdata`),
 * the `#text` of a node that also carries attributes, or the joined parts
 * of mixed content. Anything else (attributes-only node, missing field)
 * is "".
 */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (isParsedNode(value)) {
    if ("__cdata" in value) return textOf(value.__cdata);
    if ("#text" in value) return textOf(value["#text"]);
  }
  return "";
}

/**
 * Cover image from the item's `<enclosure>` when it is an image (verified on
 * the 2026-09-30 snapshot: the enclosure carries the post image even though
 * its `type` attribute can disagree with the URL's extension).
 */
function extractEnclosureImage(item: ParsedNode): string | null {
  const enclosures = Array.isArray(item.enclosure) ? item.enclosure : [item.enclosure];
  for (const enclosure of enclosures) {
    if (!isParsedNode(enclosure)) continue;
    const url = enclosure["@_url"];
    const type = enclosure["@_type"];
    if (typeof url === "string" && url && typeof type === "string" && type.startsWith("image/")) {
      return url;
    }
  }
  return null;
}

/** Slug from the item link's `/p/<slug>` path, or "" for unparseable links. */
function slugFromLink(link: string): string {
  try {
    return new URL(link).pathname.replace(/^\/p\//, "").replace(/\/$/, "");
  } catch {
    return "";
  }
}

/** RFC 822 `pubDate` → ISO 8601; "" when the date cannot be parsed. */
function toIsoTimestamp(rfc822Date: string): string {
  const parsed = new Date(rfc822Date);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function mapFeedItem(item: ParsedNode): ParsedFeedItem {
  const link = textOf(item.link);
  return {
    // The GUID is the post URL, not a numeric id — 0 means "unavailable";
    // key on canonicalUrl/slug (see .brain-project/knowledge/substack-rss/).
    id: 0,
    title: textOf(item.title),
    subtitle: textOf(item.description) || null,
    slug: slugFromLink(link),
    postDate: toIsoTimestamp(textOf(item.pubDate)),
    canonicalUrl: link,
    coverImage: extractEnclosureImage(item),
    // The feed exposes no audience/paywall/type; mirror the archive
    // mapper's defaults instead of inventing per-item values.
    audience: "everyone",
    isPaywalled: false,
    type: "newsletter",
    author: textOf(item["dc:creator"]) || null,
    bodyHtml: textOf(item["content:encoded"]) || null,
  };
}

/**
 * Extract every `<item>` of a feed document, mapped to the full record
 * (lean post fields + author + bodyHtml). A document with no items
 * (including malformed XML) yields [] — emptiness is not an error, the feed
 * is a snapshot that can legitimately hold zero posts.
 */
function parseFeedItemRecords(xml: string): ParsedFeedItem[] {
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    return [];
  }

  const root = parsed as { rss?: { channel?: { item?: unknown } } };
  const item = root.rss?.channel?.item;
  if (item === undefined || item === null) return [];
  const items = Array.isArray(item) ? item : [item];
  return items.filter(isParsedNode).map(mapFeedItem);
}

/**
 * The LEAN post list: the same shape `fetchPublications()` returns from the
 * archive client. Content fields (author, bodyHtml) are stripped here —
 * bodies are fetched per post via `fetchPostContent()`, not with the list.
 */
export function parseFeedItems(xml: string): SubstackPublicationPost[] {
  return parseFeedItemRecords(xml).map(({ author: _author, bodyHtml: _bodyHtml, ...post }) => post);
}

/**
 * Find ONE feed item by its canonicalUrl or slug and return the content the
 * list leaves out. Returns null when the feed holds no such post.
 */
export function findFeedItemContent(
  xml: string,
  key: string,
): FeedSubstackPostContent | null {
  const item = parseFeedItemRecords(xml).find(
    (candidate) => candidate.canonicalUrl === key || candidate.slug === key,
  );
  if (!item) return null;
  return {
    title: item.title,
    subtitle: item.subtitle,
    postDate: item.postDate,
    canonicalUrl: item.canonicalUrl,
    slug: item.slug,
    author: item.author,
    bodyHtml: item.bodyHtml,
  };
}
