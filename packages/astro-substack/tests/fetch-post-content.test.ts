/**
 * Unit tests for SubstackInitiator.fetchPostContent — stubbed fetch.
 *
 * Run: node --test tests/fetch-post-content.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SubstackInitiator } from "../lib/substack/index.ts";
import { PUBLIC_PROXY_BASE_URL } from "../types/index.ts";

const PUBLICATION = "https://fadlansthought.substack.com/";

/** Stub global fetch for the duration of `fn`. */
async function withFetchStub(
  stub: (url: URL, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Mirror of the publication-host content endpoint's top-level post object. */
const SAMPLE_CONTENT = {
  title: "Test Post",
  subtitle: "A test subtitle",
  slug: "test-post",
  post_date: "2026-09-22T10:00:00.000Z",
  canonical_url: "https://fadlansthought.substack.com/p/test-post",
  body_html: "<p>Hello <em>world</em></p>",
  cover_image: "https://substackcdn.com/image/fetch/test.jpg",
  audience: "everyone",
  type: "newsletter",
  publishedBylines: [{ name: "Fadlan.md", handle: "fadlanmd" }],
};

test("fetchPostContent requests {handle}/api/v1/posts/{slug} from slug and canonicalUrl", async () => {
  const client = new SubstackInitiator(PUBLICATION);

  const requested: Array<URL | string> = [];
  await withFetchStub(
    (url) => {
      requested.push(url);
      return Promise.resolve(jsonResponse(SAMPLE_CONTENT));
    },
    async () => {
      await client.fetchPostContent("test-post");
      await client.fetchPostContent(
        "https://fadlansthought.substack.com/p/test-post",
      );
    },
  );

  const expected = `${PUBLICATION}api/v1/posts/test-post`;
  assert.equal(requested.length, 2);
  assert.equal(String(requested[0]), expected, "bare slug must hit the content endpoint");
  assert.equal(String(requested[1]), expected, "canonicalUrl must reduce to the same request");
});

test("fetchPostContent routes proxy: \"public\" through the shared proxy", async () => {
  const client = new SubstackInitiator(PUBLICATION);

  let requested: URL | string | undefined;
  await withFetchStub(
    (url) => {
      requested = url;
      return Promise.resolve(jsonResponse(SAMPLE_CONTENT));
    },
    async () => {
      await client.fetchPostContent("test-post", { proxy: "public" });
    },
  );

  assert.equal(
    requested,
    PUBLIC_PROXY_BASE_URL +
      "?url=" +
      encodeURIComponent(`${PUBLICATION}api/v1/posts/test-post`),
  );
});

test("fetchPostContent returns null on 404 without throwing", async () => {
  const client = new SubstackInitiator(PUBLICATION);

  await withFetchStub(
    () => Promise.resolve(jsonResponse({ error: "Post not found" }, 404)),
    async () => {
      assert.equal(await client.fetchPostContent("missing-post"), null);
    },
  );
});

test("fetchPostContent maps the top-level post payload to SubstackPostContent", async () => {
  const client = new SubstackInitiator(PUBLICATION);

  await withFetchStub(
    () => Promise.resolve(jsonResponse(SAMPLE_CONTENT)),
    async () => {
      const content = await client.fetchPostContent("test-post");
      assert.notEqual(content, null);
      assert.equal(content!.title, "Test Post");
      assert.equal(content!.subtitle, "A test subtitle");
      assert.equal(content!.postDate, "2026-09-22T10:00:00.000Z");
      assert.equal(
        content!.canonicalUrl,
        "https://fadlansthought.substack.com/p/test-post",
      );
      assert.equal(content!.slug, "test-post");
      assert.equal(content!.author, "Fadlan.md", "author = publishedBylines[0].name");
      assert.equal(content!.coverImage, "https://substackcdn.com/image/fetch/test.jpg");
      assert.equal(content!.audience, "everyone");
      assert.equal(content!.isPaywalled, false);
      assert.equal(content!.type, "newsletter");
      assert.equal(content!.bodyHtml, "<p>Hello <em>world</em></p>");
    },
  );
});

test("fetchPostContent flags paywalled posts from the audience field", async () => {
  const client = new SubstackInitiator(PUBLICATION);

  await withFetchStub(
    () =>
      Promise.resolve(
        jsonResponse({
          ...SAMPLE_CONTENT,
          audience: "paid",
          body_html: "<p>Teaser only</p>",
        }),
      ),
    async () => {
      const content = await client.fetchPostContent("test-post");
      assert.equal(content!.isPaywalled, true);
      assert.equal(content!.audience, "paid");
    },
  );
});

test("fetchPostContent throws TypeError on a non-JSON 200 body", async () => {
  const client = new SubstackInitiator(PUBLICATION);

  await withFetchStub(
    () =>
      Promise.resolve(
        new Response("<html>Just a moment...</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    async () => {
      await assert.rejects(
        client.fetchPostContent("test-post"),
        (error: unknown) =>
          error instanceof TypeError &&
          /non-JSON body/.test(error.message),
      );
    },
  );
});

test("fetchPostContent returns null for an empty key without fetching", async () => {
  const client = new SubstackInitiator(PUBLICATION);

  let fetched = false;
  await withFetchStub(
    () => {
      fetched = true;
      return Promise.resolve(jsonResponse(SAMPLE_CONTENT));
    },
    async () => {
      assert.equal(await client.fetchPostContent(""), null);
    },
  );
  assert.equal(fetched, false, "an empty slug must not reach the network");
});
