/**
 * Unit tests for SubstackInitiator.fetchPublications() — no network access.
 * `globalThis.fetch` is stubbed so the mapping/validation/error logic is
 * tested in isolation.
 *
 * Run: node --test tests/
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SubstackInitiator } from "../lib/substack/index.ts";

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

const SAMPLE_POST = {
  id: 216460560,
  title: "Are You Tone-Deaf for Practicing Mindfulness?",
  subtitle: 'How "Tone-Listening" Helps You Protect Your Sanity',
  slug: "are-you-tone-deaf-for-practicing",
  post_date: "2026-09-19T15:59:11.064Z",
  canonical_url:
    "https://fadlansthought.substack.com/p/are-you-tone-deaf-for-practicing",
  cover_image: "https://substack-post-media.s3.amazonaws.com/public/images/x.png",
  audience: "everyone",
  is_paid: null,
  type: "newsletter",
};

test("constructor accepts the publication handle", () => {
  const client = new SubstackInitiator(PUBLICATION);
  assert.ok(client instanceof SubstackInitiator);
});

test("fetchPublications omits the limit param when not set (returns all posts)", async () => {
  const client = new SubstackInitiator(PUBLICATION);
  let requested: URL | undefined;

  await withFetchStub(
    (url) => {
      requested = url;
      return Promise.resolve(jsonResponse([SAMPLE_POST]));
    },
    async () => {
      const posts = await client.fetchPublications();
      assert.equal(posts.length, 1);
    },
  );

  assert.ok(requested, "fetch was not called");
  assert.equal(requested.origin, "https://fadlansthought.substack.com");
  assert.equal(requested.pathname, "/api/v1/archive");
  assert.equal(requested.searchParams.get("sort"), "new");
  assert.equal(requested.searchParams.get("offset"), "0");
  assert.equal(
    requested.searchParams.get("limit"),
    null,
    "limit param must be absent so Substack returns all posts",
  );
});

test("fetchPublications maps raw archive entries to the public shape", async () => {
  const client = new SubstackInitiator(PUBLICATION);

  await withFetchStub(
    () => Promise.resolve(jsonResponse([SAMPLE_POST])),
    async () => {
      const [post] = await client.fetchPublications();
      assert.deepEqual(post, {
        id: 216460560,
        title: "Are You Tone-Deaf for Practicing Mindfulness?",
        subtitle: 'How "Tone-Listening" Helps You Protect Your Sanity',
        slug: "are-you-tone-deaf-for-practicing",
        postDate: "2026-09-19T15:59:11.064Z",
        canonicalUrl:
          "https://fadlansthought.substack.com/p/are-you-tone-deaf-for-practicing",
        coverImage:
          "https://substack-post-media.s3.amazonaws.com/public/images/x.png",
        audience: "everyone",
        isPaywalled: false,
        type: "newsletter",
      });
    },
  );
});

test("fetchPublications flags paywalled posts from audience field", async () => {
  const client = new SubstackInitiator(PUBLICATION);

  await withFetchStub(
    () =>
      Promise.resolve(
        jsonResponse([{ ...SAMPLE_POST, audience: "paid", is_paid: null }]),
      ),
    async () => {
      const [post] = await client.fetchPublications();
      assert.equal(post.isPaywalled, true);
      assert.equal(post.audience, "paid");
    },
  );
});

test("fetchPublications flags paywalled posts from is_paid fallback", async () => {
  const client = new SubstackInitiator(PUBLICATION);

  await withFetchStub(
    () =>
      Promise.resolve(
        jsonResponse([{ ...SAMPLE_POST, audience: "everyone", is_paid: true }]),
      ),
    async () => {
      const [post] = await client.fetchPublications();
      assert.equal(post.isPaywalled, true);
    },
  );
});

test("fetchPublications forwards custom limit and sort", async () => {
  const client = new SubstackInitiator(PUBLICATION);
  let requested: URL | undefined;

  await withFetchStub(
    (url) => {
      requested = url;
      return Promise.resolve(jsonResponse([]));
    },
    async () => {
      const posts = await client.fetchPublications({ limit: 3, sort: "top" });
      assert.deepEqual(posts, []);
    },
  );

  assert.equal(requested?.searchParams.get("limit"), "3");
  assert.equal(requested?.searchParams.get("sort"), "top");
});

test("fetchPublications rejects an empty handle", async () => {
  const client = new SubstackInitiator("");
  await assert.rejects(client.fetchPublications(), RangeError);
});

test("fetchPublications falls back to limit 50 when the input is invalid", async () => {
  const client = new SubstackInitiator(PUBLICATION);
  let requested: URL | undefined;

  await withFetchStub(
    (url) => {
      requested = url;
      return Promise.resolve(jsonResponse([SAMPLE_POST]));
    },
    async () => {
      // out of range, non-integer, zero, negative — all clamp to 50
      await client.fetchPublications({ limit: 51 });
      assert.equal(requested?.searchParams.get("limit"), "50");
      await client.fetchPublications({ limit: 10.5 });
      assert.equal(requested?.searchParams.get("limit"), "50");
      await client.fetchPublications({ limit: 0 });
      assert.equal(requested?.searchParams.get("limit"), "50");
      await client.fetchPublications({ limit: -3 });
      assert.equal(requested?.searchParams.get("limit"), "50");
      // valid boundary values are sent as-is
      await client.fetchPublications({ limit: 1 });
      assert.equal(requested?.searchParams.get("limit"), "1");
      await client.fetchPublications({ limit: 50 });
      assert.equal(requested?.searchParams.get("limit"), "50");
    },
  );
});

test("fetchPublications throws a descriptive error on HTTP failure", async () => {
  const client = new SubstackInitiator(PUBLICATION);

  await withFetchStub(
    () => Promise.resolve(jsonResponse({ error: "nope" }, 503)),
    async () => {
      await assert.rejects(client.fetchPublications(), /HTTP 503/);
    },
  );
});

test("fetchPublications throws when the payload is not an array", async () => {
  const client = new SubstackInitiator(PUBLICATION);

  await withFetchStub(
    () => Promise.resolve(jsonResponse({ posts: [] })),
    async () => {
      await assert.rejects(client.fetchPublications(), TypeError);
    },
  );
});

test("fetchPublications surfaces network failures with the target URL", async () => {
  const client = new SubstackInitiator(PUBLICATION);

  await withFetchStub(
    () => Promise.reject(new Error("ECONNREFUSED")),
    async () => {
      await assert.rejects(
        client.fetchPublications(),
        /Failed to reach Substack archive.*ECONNREFUSED/s,
      );
    },
  );
});

test("handle without scheme is normalized to https", async () => {
  const client = new SubstackInitiator("fadlansthought.substack.com");
  let requested: URL | undefined;

  await withFetchStub(
    (url) => {
      requested = url;
      return Promise.resolve(jsonResponse([]));
    },
    async () => {
      await client.fetchPublications();
    },
  );

  assert.equal(requested?.origin, "https://fadlansthought.substack.com");
});
