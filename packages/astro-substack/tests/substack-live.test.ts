/**
 * Integration test — hits the REAL Substack archive endpoint.
 * Skipped unless SUBSTACK_LIVE_TEST=1 is set, so plain `node --test` and
 * CI builds never depend on network access or Substack availability.
 *
 * Run: SUBSTACK_LIVE_TEST=1 node --test tests/
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SubstackInitiator } from "../lib/substack/index.ts";

const LIVE = process.env.SUBSTACK_LIVE_TEST === "1";
const PUBLICATION = "https://fadlansthought.substack.com/";

test(
  "fetchPublications returns live posts from fadlansthought.substack.com",
  { skip: LIVE ? false : "set SUBSTACK_LIVE_TEST=1 to enable" },
  async () => {
    const client = new SubstackInitiator(PUBLICATION);
    const posts = await client.fetchPublications({ limit: 5 });
    console.log("LIVE POSTS:", JSON.stringify(posts, null, 2));

    assert.ok(Array.isArray(posts));
    assert.ok(posts.length > 0, "expected at least one published post");
    for (const post of posts) {
      assert.equal(typeof post.id, "number");
      assert.ok(post.title.length > 0);
      assert.ok(post.slug.length > 0);
      assert.ok(post.canonicalUrl.startsWith("https://"));
      assert.ok(!Number.isNaN(Date.parse(post.postDate)));
      assert.equal(typeof post.isPaywalled, "boolean");
    }
  },
);
