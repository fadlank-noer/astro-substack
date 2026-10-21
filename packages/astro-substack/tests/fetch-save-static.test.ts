/**
 * Unit tests for StaticSubstackInitiator — stubbed fetch.
 * 
 * Run: node --test tests/fetch-save-static.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StaticSubstackInitiator } from "../lib/substack/index.ts";

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
  title: "Test Post",
  slug: "test-post",
  post_date: "2026-09-22T10:00:00.000Z",
  canonical_url: "https://fadlansthought.substack.com/p/test-post",
  audience: "everyone",
  is_paid: null,
  type: "newsletter",
};

test("saveStaticPosts() writes posts.json with metadata", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-static-test-"));
  const client = new StaticSubstackInitiator(PUBLICATION, tmpDir);
  
  try {
    await withFetchStub(
      () => Promise.resolve(jsonResponse([SAMPLE_POST])),
      async () => {
        await client.saveStaticPosts({ limit: 10, sort: "top" });
      },
    );
    
    const postsPath = join(tmpDir, "__substack_rendered", "posts.json");
    const content = await readFile(postsPath, "utf-8");
    const data = JSON.parse(content);
    
    assert.equal(data.version, 1);
    assert.equal(data.handle, PUBLICATION);
    assert.ok(data.fetchedAt, "fetchedAt should be present");
    assert.equal(data.sort, "top");
    assert.equal(data.limit, 10);
    assert.equal(data.posts.length, 1);
    assert.equal(data.posts[0].title, "Test Post");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("saveStaticPosts() overwrites existing directory", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-static-test-"));
  const client = new StaticSubstackInitiator(PUBLICATION, tmpDir);
  
  try {
    // First save
    await withFetchStub(
      () => Promise.resolve(jsonResponse([{ ...SAMPLE_POST, title: "First" }])),
      async () => {
        await client.saveStaticPosts();
      },
    );
    
    // Second save with different data
    await withFetchStub(
      () => Promise.resolve(jsonResponse([{ ...SAMPLE_POST, title: "Second" }])),
      async () => {
        await client.saveStaticPosts();
      },
    );
    
    const postsPath = join(tmpDir, "__substack_rendered", "posts.json");
    const content = await readFile(postsPath, "utf-8");
    const data = JSON.parse(content);
    
    assert.equal(data.posts.length, 1);
    assert.equal(data.posts[0].title, "Second", "Should overwrite with latest data");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("saveStaticPosts() throws on network failure", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-static-test-"));
  const client = new StaticSubstackInitiator(PUBLICATION, tmpDir);
  
  try {
    await withFetchStub(
      () => Promise.reject(new Error("ECONNREFUSED")),
      async () => {
        await assert.rejects(
          client.saveStaticPosts(),
          /Failed to reach Substack archive/,
        );
      },
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("loadStaticPosts() reads valid posts.json", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-static-test-"));
  const client = new StaticSubstackInitiator(PUBLICATION, tmpDir);
  
  try {
    // Create test file
    const renderedDir = join(tmpDir, "__substack_rendered");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(renderedDir, { recursive: true });
    const postsJson = join(renderedDir, "posts.json");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(postsJson, JSON.stringify({
        version: 1,
        handle: PUBLICATION,
        fetchedAt: "2026-09-22T10:00:00.000Z",
        sort: "new",
        limit: null,
        posts: [SAMPLE_POST]
      }, null, 2))
    );

    const result = await client.loadStaticPosts();

    assert.equal(result.meta.version, 1);
    assert.equal(result.meta.handle, PUBLICATION);
    assert.equal(result.meta.fetchedAt, "2026-09-22T10:00:00.000Z");
    assert.equal(result.meta.sort, "new");
    assert.equal(result.meta.limit, null);
    assert.equal(result.posts.length, 1);
    assert.equal(result.posts[0].title, "Test Post");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("loadStaticPosts() defaults handle to empty for pre-handle posts.json", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-static-test-"));
  const client = new StaticSubstackInitiator(PUBLICATION, tmpDir);

  try {
    const renderedDir = join(tmpDir, "__substack_rendered");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(renderedDir, { recursive: true });
    const postsJson = join(renderedDir, "posts.json");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(postsJson, JSON.stringify({
        version: 1,
        fetchedAt: "2026-09-22T10:00:00.000Z",
        sort: "new",
        limit: null,
        posts: [SAMPLE_POST]
      }, null, 2))
    );

    const result = await client.loadStaticPosts();

    assert.equal(result.meta.version, 1, "old file must still load without a version bump");
    assert.equal(result.meta.handle, "");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("loadStaticPosts() throws when file does not exist", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-static-test-"));
  const client = new StaticSubstackInitiator(PUBLICATION, tmpDir);

  try {
    await assert.rejects(client.loadStaticPosts(), /Failed to read static posts/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

/** Raw content-endpoint payload for one slug (top-level post object). */
function sampleContentPayload(slug: string, bodyHtml: string) {
  return {
    title: `Post ${slug}`,
    subtitle: null,
    slug,
    post_date: "2026-09-22T10:00:00.000Z",
    canonical_url: `${PUBLICATION}p/${slug}`,
    body_html: bodyHtml,
    cover_image: null,
    audience: "everyone",
    type: "newsletter",
    publishedBylines: [{ name: "Fadlan.md" }],
  };
}

function stubArchiveAndContent(posts: unknown[], contentBySlug: Record<string, unknown | 404>) {
  return (url: URL) => {
    if (url.pathname.endsWith("/api/v1/archive")) {
      return Promise.resolve(jsonResponse(posts));
    }
    for (const [slug, payload] of Object.entries(contentBySlug)) {
      if (url.pathname.endsWith(`/api/v1/posts/${slug}`)) {
        return Promise.resolve(
          payload === 404
            ? jsonResponse({ error: "Post not found" }, 404)
            : jsonResponse(payload),
        );
      }
    }
    return Promise.resolve(jsonResponse({ error: "Post not found" }, 404));
  };
}

test("saveStaticArticles() writes one envelope per post from the posts.json snapshot", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-static-test-"));
  const client = new StaticSubstackInitiator(PUBLICATION, tmpDir);

  try {
    await withFetchStub(
      stubArchiveAndContent(
        [
          SAMPLE_POST,
          { ...SAMPLE_POST, slug: "second-post", title: "Second" },
          // unsafe filenames — must be skipped, never written
          { ...SAMPLE_POST, slug: "" },
          { ...SAMPLE_POST, slug: "../evil" },
          { ...SAMPLE_POST, slug: "with/slash" },
        ],
        {
          "test-post": sampleContentPayload("test-post", "<p>First body</p>"),
          "second-post": sampleContentPayload("second-post", "<p>Second body</p>"),
        },
      ),
      async () => {
        await client.saveStaticPosts();
        await client.saveStaticArticles();
      },
    );

    const articlesDir = join(tmpDir, "__substack_rendered", "articles");

    const alpha = JSON.parse(await readFile(join(articlesDir, "test-post.json"), "utf-8"));
    assert.equal(alpha.version, 1);
    assert.equal(alpha.handle, PUBLICATION);
    assert.ok(alpha.fetchedAt, "fetchedAt should be present");
    assert.equal(alpha.slug, "test-post");
    assert.equal(alpha.content.bodyHtml, "<p>First body</p>");
    assert.equal(alpha.content.author, "Fadlan.md");

    const beta = JSON.parse(await readFile(join(articlesDir, "second-post.json"), "utf-8"));
    assert.equal(beta.content.bodyHtml, "<p>Second body</p>");

    // D10: unsafe slugs are skipped, not written
    await assert.rejects(readFile(join(articlesDir, ".json"), "utf-8"));
    await assert.rejects(readFile(join(articlesDir, "with/slash.json"), "utf-8"));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("saveStaticArticles() keeps going on 404 — file written with content: null", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-static-test-"));
  const client = new StaticSubstackInitiator(PUBLICATION, tmpDir);

  try {
    await withFetchStub(
      stubArchiveAndContent(
        [SAMPLE_POST, { ...SAMPLE_POST, slug: "second-post" }],
        {
          "test-post": 404,
          "second-post": sampleContentPayload("second-post", "<p>Body</p>"),
        },
      ),
      async () => {
        await client.saveStaticPosts();
        await client.saveStaticArticles();
      },
    );

    const alpha = JSON.parse(
      await readFile(join(tmpDir, "__substack_rendered", "articles", "test-post.json"), "utf-8"),
    );
    assert.equal(alpha.content, null, "404 mid-save must persist as content: null (D1)");

    const beta = JSON.parse(
      await readFile(join(tmpDir, "__substack_rendered", "articles", "second-post.json"), "utf-8"),
    );
    assert.equal(beta.content.bodyHtml, "<p>Body</p>");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("saveStaticArticles() wipes stale articles from previous runs", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-static-test-"));
  const client = new StaticSubstackInitiator(PUBLICATION, tmpDir);

  try {
    const renderedDir = join(tmpDir, "__substack_rendered");
    await mkdir(join(renderedDir, "articles"), { recursive: true });
    await writeFile(
      join(renderedDir, "articles", "stale-post.json"),
      JSON.stringify({ version: 1, slug: "stale-post" }),
    );

    await withFetchStub(
      stubArchiveAndContent([SAMPLE_POST], {
        "test-post": sampleContentPayload("test-post", "<p>Body</p>"),
      }),
      async () => {
        await client.saveStaticPosts();
        await client.saveStaticArticles();
      },
    );

    const articlesDir = join(renderedDir, "articles");
    const kept = await readFile(join(articlesDir, "test-post.json"), "utf-8");
    assert.ok(kept.includes("test-post"));
    await assert.rejects(readFile(join(articlesDir, "stale-post.json"), "utf-8"));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("loadStaticArticle() roundtrips and throws loud on missing/malformed files", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-static-test-"));
  const client = new StaticSubstackInitiator(PUBLICATION, tmpDir);

  try {
    const articlesDir = join(tmpDir, "__substack_rendered", "articles");
    await mkdir(articlesDir, { recursive: true });

    const envelope = {
      version: 1,
      handle: PUBLICATION,
      fetchedAt: "2026-10-21T10:00:00.000Z",
      slug: "test-post",
      // content is the MAPPED SubstackPostContent (camelCase), not the raw API payload
      content: {
        title: "Post test-post",
        subtitle: null,
        postDate: "2026-09-22T10:00:00.000Z",
        canonicalUrl: `${PUBLICATION}p/test-post`,
        slug: "test-post",
        author: "Fadlan.md",
        coverImage: null,
        audience: "everyone",
        isPaywalled: false,
        type: "newsletter",
        bodyHtml: "<p>Roundtrip</p>",
      },
    };
    await writeFile(join(articlesDir, "test-post.json"), JSON.stringify(envelope, null, 2));
    await writeFile(
      join(articlesDir, "future-version.json"),
      JSON.stringify({ ...envelope, slug: "future-version", version: 2 }),
    );

    const loaded = await client.loadStaticArticle("test-post");
    assert.equal(loaded.version, 1);
    assert.equal(loaded.slug, "test-post");
    assert.equal(loaded.fetchedAt, "2026-10-21T10:00:00.000Z");
    assert.equal(loaded.content.bodyHtml, "<p>Roundtrip</p>");

    // content: null is VALID (D11 — key presence, not truthiness)
    await writeFile(
      join(articlesDir, "null-content.json"),
      JSON.stringify({ ...envelope, slug: "null-content", content: null }),
    );
    const nulled = await client.loadStaticArticle("null-content");
    assert.equal(nulled.content, null);

    await assert.rejects(
      client.loadStaticArticle("missing-post"),
      /Failed to read static article from .*missing-post\.json/,
    );
    await assert.rejects(
      client.loadStaticArticle("future-version"),
      /Unsupported static article schema version: 2/,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("saveAll() chains list+content — one archive fetch, posts.json AND articles/ written", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-static-test-"));
  const client = new StaticSubstackInitiator(PUBLICATION, tmpDir);

  try {
    let archiveFetches = 0;
    await withFetchStub(
      (url) => {
        if (url.pathname.endsWith("/api/v1/archive")) archiveFetches += 1;
        return stubArchiveAndContent(
          [SAMPLE_POST, { ...SAMPLE_POST, slug: "second-post" }],
          {
            "test-post": sampleContentPayload("test-post", "<p>First body</p>"),
            "second-post": sampleContentPayload("second-post", "<p>Second body</p>"),
          },
        )(url);
      },
      async () => {
        await client.saveAll({ limit: 10 });
      },
    );

    const postsData = JSON.parse(
      await readFile(join(tmpDir, "__substack_rendered", "posts.json"), "utf-8"),
    );
    assert.equal(postsData.posts.length, 2, "posts.json written by the chained call");

    const articlesDir = join(tmpDir, "__substack_rendered", "articles");
    const alpha = JSON.parse(await readFile(join(articlesDir, "test-post.json"), "utf-8"));
    assert.equal(alpha.content.bodyHtml, "<p>First body</p>");
    const beta = JSON.parse(await readFile(join(articlesDir, "second-post.json"), "utf-8"));
    assert.equal(beta.content.bodyHtml, "<p>Second body</p>");

    assert.equal(archiveFetches, 1, "the list must be fetched exactly once (A1)");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("saveStaticArticles() throws loud when posts.json was never written (A1)", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-static-test-"));
  const client = new StaticSubstackInitiator(PUBLICATION, tmpDir);

  try {
    await withFetchStub(
      stubArchiveAndContent([SAMPLE_POST], {}),
      async () => {
        await assert.rejects(
          client.saveStaticArticles(),
          /Failed to read static posts/,
        );
      },
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
