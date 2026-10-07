/**
 * Unit tests for FeedSubstackInitiator.fetchPublications() and the RSS feed
 * parser — no network access. `globalThis.fetch` is stubbed and the sample
 * XML mirrors the structure of the 2026-09-30 feed snapshot in
 * .brain-project/knowledge/substack-rss/ (CDATA fields, dc:creator,
 * content:encoded, image enclosure).
 *
 * Run: node --test tests/
 */
import test from "node:test";
import assert from "node:assert/strict";

import { FeedSubstackInitiator } from "../lib/substack/index.ts";
import {
  PUBLIC_PROXY_BASE_URL,
  type FeedSubstackPostContent,
  type SubstackPublicationPost,
} from "../types/index.ts";

const PUBLICATION = "https://fadlansthought.substack.com/";

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0"><channel><title><![CDATA[Fadlan.md]]></title><link>https://fadlansthought.substack.com</link><item><title><![CDATA[Are You Tone-Deaf for Practicing Mindfulness?]]></title><description><![CDATA[How "Tone-Listening" Helps You Protect Your Sanity]]></description><link>https://fadlansthought.substack.com/p/are-you-tone-deaf-for-practicing</link><guid isPermaLink="false">https://fadlansthought.substack.com/p/are-you-tone-deaf-for-practicing</guid><dc:creator><![CDATA[Fadlan.md]]></dc:creator><pubDate>Fri, 19 Sep 2026 15:59:11 GMT</pubDate><enclosure url="https://substack-post-media.s3.amazonaws.com/public/images/x.png" length="0" type="image/jpeg"/><content:encoded><![CDATA[<p>Mindfulness &amp; sanity &#8212; the body &lt;em&gt;counts&lt;/em&gt;.</p>]]></content:encoded></item><item><title>Plain Title Without CDATA</title><description>Subtitle &amp; entities</description><link>https://fadlansthought.substack.com/p/plain-title</link><guid>https://fadlansthought.substack.com/p/plain-title</guid><dc:creator><![CDATA[Other Author]]></dc:creator><pubDate>Sun, 13 Sep 2026 07:56:25 GMT</pubDate><content:encoded><![CDATA[<p>Second body</p>]]></content:encoded></item><item><title><![CDATA[No Content Item]]></title><link>https://fadlansthought.substack.com/p/no-content</link><pubDate>not-a-date</pubDate></item></channel></rss>`;

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

function feedResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

test("fetchPublications requests {handle}/feed with no query params", async () => {
  const client = new FeedSubstackInitiator(PUBLICATION);
  let requested: URL | undefined;

  await withFetchStub(
    (url) => {
      requested = url;
      return Promise.resolve(feedResponse(SAMPLE_FEED));
    },
    async () => {
      // sort is accepted for signature compatibility but must not be sent
      await client.fetchPublications({ sort: "top" });
    },
  );

  assert.ok(requested, "fetch was not called");
  assert.equal(requested.origin, "https://fadlansthought.substack.com");
  assert.equal(requested.pathname, "/feed");
  assert.equal(
    requested.search,
    "",
    "the feed has no pagination or sort params — none must be sent",
  );
});

test("fetchPublications maps feed items to the lean post shape (no content)", async () => {
  const client = new FeedSubstackInitiator(PUBLICATION);

  await withFetchStub(
    () => Promise.resolve(feedResponse(SAMPLE_FEED)),
    async () => {
      const posts: SubstackPublicationPost[] = await client.fetchPublications();
      assert.equal(posts.length, 3);
      assert.deepEqual(posts[0], {
        id: 0,
        title: "Are You Tone-Deaf for Practicing Mindfulness?",
        subtitle: 'How "Tone-Listening" Helps You Protect Your Sanity',
        slug: "are-you-tone-deaf-for-practicing",
        postDate: "2026-09-19T15:59:11.000Z",
        canonicalUrl:
          "https://fadlansthought.substack.com/p/are-you-tone-deaf-for-practicing",
        coverImage:
          "https://substack-post-media.s3.amazonaws.com/public/images/x.png",
        audience: "everyone",
        isPaywalled: false,
        type: "newsletter",
        // NO author / bodyHtml: the list stays lean like the archive
        // client — content is fetched per post via fetchPostContent().
      });
      assert.equal("bodyHtml" in posts[0], false);
      assert.equal("author" in posts[0], false);
    },
  );
});

test("fetchPostContent returns the full content by canonicalUrl", async () => {
  const client = new FeedSubstackInitiator(PUBLICATION);

  await withFetchStub(
    () => Promise.resolve(feedResponse(SAMPLE_FEED)),
    async () => {
      const content: FeedSubstackPostContent | null = await client.fetchPostContent(
        "https://fadlansthought.substack.com/p/are-you-tone-deaf-for-practicing",
      );
      assert.notEqual(content, null);
      assert.equal(content!.title, "Are You Tone-Deaf for Practicing Mindfulness?");
      assert.equal(content!.slug, "are-you-tone-deaf-for-practicing");
      assert.equal(content!.postDate, "2026-09-19T15:59:11.000Z");
      assert.equal(content!.author, "Fadlan.md");
      // content:encoded is HTML — its entities belong to the body and
      // must survive verbatim, NOT be decoded by the XML layer.
      assert.equal(
        content!.bodyHtml,
        "<p>Mindfulness &amp; sanity &#8212; the body &lt;em&gt;counts&lt;/em&gt;.</p>",
      );
    },
  );
});

test("fetchPostContent matches by slug too", async () => {
  const client = new FeedSubstackInitiator(PUBLICATION);

  await withFetchStub(
    () => Promise.resolve(feedResponse(SAMPLE_FEED)),
    async () => {
      const content = await client.fetchPostContent("plain-title");
      assert.equal(content?.title, "Plain Title Without CDATA");
      assert.equal(content?.subtitle, "Subtitle & entities");
      assert.equal(content?.bodyHtml, "<p>Second body</p>");
    },
  );
});

test("fetchPostContent returns null when the feed holds no such post", async () => {
  const client = new FeedSubstackInitiator(PUBLICATION);

  await withFetchStub(
    () => Promise.resolve(feedResponse(SAMPLE_FEED)),
    async () => {
      assert.equal(await client.fetchPostContent("https://x.substack.com/p/unknown"), null);
      assert.equal(await client.fetchPostContent("not-a-real-slug"), null);
    },
  );
});

test("fetchPostContent forwards proxy options through the shared transport", async () => {
  let requested: URL | string | undefined;

  await withFetchStub(
    (url) => {
      requested = url;
      return Promise.resolve(feedResponse(SAMPLE_FEED));
    },
    async () => {
      const client = new FeedSubstackInitiator(PUBLICATION);
      await client.fetchPostContent("plain-title", { proxy: "public" });
    },
  );

  assert.equal(
    requested,
    PUBLIC_PROXY_BASE_URL + "?url=" + encodeURIComponent(`${PUBLICATION}feed`),
  );
});

test("plain-text fields get XML entities decoded, CDATA fields do not", async () => {
  const client = new FeedSubstackInitiator(PUBLICATION);

  await withFetchStub(
    () => Promise.resolve(feedResponse(SAMPLE_FEED)),
    async () => {
      const posts = await client.fetchPublications();
      assert.equal(posts[1].title, "Plain Title Without CDATA");
      assert.equal(posts[1].subtitle, "Subtitle & entities");
    },
  );
});

test("missing feed fields fall back to null/empty like the archive mapper", async () => {
  const client = new FeedSubstackInitiator(PUBLICATION);

  await withFetchStub(
    () => Promise.resolve(feedResponse(SAMPLE_FEED)),
    async () => {
      const [noContent] = (await client.fetchPublications()).slice(2);
      assert.equal(noContent.subtitle, null);
      assert.equal(noContent.coverImage, null);
      assert.equal(noContent.postDate, "", "unparseable pubDate must not become a bogus ISO string");
      // author/bodyHtml live on the CONTENT object, not the lean list
      const content = await client.fetchPostContent("no-content");
      assert.equal(content?.author, null);
      assert.equal(content?.bodyHtml, null);
    },
  );
});

test("limit is applied client-side and invalid limits are ignored", async () => {
  const client = new FeedSubstackInitiator(PUBLICATION);

  await withFetchStub(
    () => Promise.resolve(feedResponse(SAMPLE_FEED)),
    async () => {
      assert.equal((await client.fetchPublications({ limit: 2 })).length, 2);
      // no server-side cap exists, so out-of-range garbage means "no limit"
      assert.equal((await client.fetchPublications({ limit: 0 })).length, 3);
      assert.equal((await client.fetchPublications({ limit: 10.5 })).length, 3);
      assert.equal((await client.fetchPublications({ limit: -3 })).length, 3);
    },
  );
});

test("fetchPublications routes through proxyBaseUrl when set", async () => {
  let requested: URL | string | undefined;

  await withFetchStub(
    (url) => {
      requested = url;
      return Promise.resolve(feedResponse(SAMPLE_FEED));
    },
    async () => {
      const client = new FeedSubstackInitiator(PUBLICATION);
      await client.fetchPublications({
        limit: 10,
        proxyBaseUrl: "https://proxy.example.workers.dev",
      });
    },
  );

  const expected = "https://proxy.example.workers.dev?url=" +
    encodeURIComponent(`${PUBLICATION}feed`);
  assert.equal(requested, expected);
});

test("handle without scheme is normalized to https", async () => {
  const client = new FeedSubstackInitiator("fadlansthought.substack.com");
  let requested: URL | undefined;

  await withFetchStub(
    (url) => {
      requested = url;
      return Promise.resolve(feedResponse(SAMPLE_FEED));
    },
    async () => {
      await client.fetchPublications();
    },
  );

  assert.equal(requested?.origin, "https://fadlansthought.substack.com");
  assert.equal(requested?.pathname, "/feed");
});

test("fetchPublications rejects an empty handle", async () => {
  const client = new FeedSubstackInitiator("");
  await assert.rejects(client.fetchPublications(), RangeError);
});

test("fetchPublications throws a descriptive error on HTTP failure", async () => {
  const client = new FeedSubstackInitiator(PUBLICATION);

  await withFetchStub(
    () => Promise.resolve(feedResponse("Not Found", 404)),
    async () => {
      await assert.rejects(
        client.fetchPublications(),
        /Substack RSS feed returned HTTP 404/,
      );
    },
  );
});

test("fetchPublications retries 429s and succeeds", async () => {
  const client = new FeedSubstackInitiator(PUBLICATION);
  let calls = 0;

  await withFetchStub(
    () => {
      calls++;
      return Promise.resolve(
        calls < 2 ? new Response("slow down", { status: 429 }) : feedResponse(SAMPLE_FEED),
      );
    },
    async () => {
      const posts = await client.fetchPublications({ retryDelayMs: 1 });
      assert.equal(posts.length, 3);
    },
  );

  assert.equal(calls, 2);
});

test("fetchPublications returns [] for a feed without items", async () => {
  const client = new FeedSubstackInitiator(PUBLICATION);
  const emptyFeed = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title><![CDATA[Fadlan.md]]></title><link>https://fadlansthought.substack.com</link></channel></rss>`;

  await withFetchStub(
    () => Promise.resolve(feedResponse(emptyFeed)),
    async () => {
      assert.deepEqual(await client.fetchPublications(), []);
    },
  );
});

test("proxy: 'own' uses proxyBaseUrl", async () => {
  let requested: URL | string | undefined;

  await withFetchStub(
    (url) => {
      requested = url;
      return Promise.resolve(feedResponse(SAMPLE_FEED));
    },
    async () => {
      const client = new FeedSubstackInitiator(PUBLICATION);
      await client.fetchPublications({
        proxy: "own",
        proxyBaseUrl: "https://own.example.workers.dev",
      });
    },
  );

  assert.equal(
    requested,
    "https://own.example.workers.dev?url=" +
      encodeURIComponent(`${PUBLICATION}feed`),
  );
});

test("proxy: 'own' without proxyBaseUrl fails loudly instead of sending an unproxied request", async () => {
  const client = new FeedSubstackInitiator(PUBLICATION);
  await assert.rejects(client.fetchPublications({ proxy: "own" }), RangeError);
});

test("proxy: 'public' routes through the shared public proxy", async () => {
  let requested: URL | string | undefined;

  await withFetchStub(
    (url) => {
      requested = url;
      return Promise.resolve(feedResponse(SAMPLE_FEED));
    },
    async () => {
      const client = new FeedSubstackInitiator(PUBLICATION);
      await client.fetchPublications({ proxy: "public" });
    },
  );

  assert.equal(
    requested,
    PUBLIC_PROXY_BASE_URL + "?url=" + encodeURIComponent(`${PUBLICATION}feed`),
  );
});
