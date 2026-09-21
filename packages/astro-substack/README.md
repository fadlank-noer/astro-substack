# Astro Substack

Fetch public posts from any Substack publication and use them in Astro — at build time, with zero runtime dependencies.

## Install

```sh
npm install astro-substack
pnpm install astro-substack
yarn install astro-substack
```

## Usage

### `SubstackInitiator`

`SubstackInitiator` is a minimal, dependency-free client for reading **public** Substack content. It accepts a publication handle — a full URL (`https://yourpub.substack.com/`), a custom domain, or a bare handle (`yourpub`) — and normalizes it internally.

```ts
import { SubstackInitiator } from "astro-substack";

const client = new SubstackInitiator("https://fadlansthought.substack.com/");
```

### `fetchPublications()`

Fetches the publication's posts from the unofficial archive endpoint (`/api/v1/archive`) and maps them to a clean, typed shape.

```ts
const posts = await client.fetchPublications();

// With options
const latest = await client.fetchPublications({
  limit: 10,       // 1-50; see below
  sort: "new",     // "new" | "top" | "pinned" | "community"
  timeoutMs: 15_000,
});
```

#### Options

| Option      | Type                                                | Default  | Behavior                                                                                                                                                  |
| ----------- | --------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limit`     | `number`                                            | —        | `1`-`50` (server-side max). **Omitted** = the `limit` param is not sent and Substack returns **all** posts. **Invalid** values (non-integer, `< 1`, `> 50`) fall back to `50`. |
| `sort`      | `"new" \| "top" \| "pinned" \| "community"`         | `"new"`  | Archive sort order.                                                                                                                                       |
| `timeoutMs` | `number`                                            | `15000`  | Request timeout via `AbortSignal.timeout`.                                                                                                                |

#### Return shape

`Promise<SubstackPublicationPost[]>`

```ts
interface SubstackPublicationPost {
  id: number;             // Numeric post id from the Substack API
  title: string;          // Post title (plain text)
  subtitle: string | null;
  slug: string;           // e.g. "are-you-tone-deaf-for-practicing"
  postDate: string;       // ISO 8601, e.g. "2026-09-19T15:59:11.064Z"
  canonicalUrl: string;   // Canonical URL on Substack
  coverImage: string | null;
  audience: string;       // Raw audience field ("everyone", "paid", ...)
  isPaywalled: boolean;   // audience "paid" or is_paid truthy
  type: string;           // Raw post type ("newsletter", "podcast", ...)
}
```

### Astro page example

Because fetches run server-side (at build time for static output), the missing CORS headers on Substack's API are not a problem:

```astro
---
import { SubstackInitiator } from "astro-substack";

const client = new SubstackInitiator("https://yourpub.substack.com/");
const posts = await client.fetchPublications();
---
<ul>
  {posts.map((post) => (
    <li>
      <a href={post.canonicalUrl}>{post.title}</a>
      <time datetime={post.postDate}>{new Date(post.postDate).toDateString()}</time>
    </li>
  ))}
</ul>
```

> [!WARNING]
> The Substack archive endpoint does **not** send `Access-Control-Allow-Origin`, so calling `fetchPublications()` from browser JavaScript on another domain will be blocked by CORS. Use it server-side (Astro frontmatter, endpoints, SSR) or behind a same-origin proxy.

## Tests

Unit tests use the built-in `node:test` runner (Node >= 22.12):

```sh
pnpm test:unit                       # from the workspace root
# or, inside packages/astro-substack:
node --test                          # offline, stubbed fetch
SUBSTACK_LIVE_TEST=1 node --test tests/substack-live.test.ts   # hits the live API
```

## License

MIT
