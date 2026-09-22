/**
 * Unit tests for StaticSubstackInitiator — stubbed fetch.
 * 
 * Run: node --test tests/fetch-save-static.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
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
        fetchedAt: "2026-09-22T10:00:00.000Z",
        sort: "new",
        limit: null,
        posts: [SAMPLE_POST]
      }, null, 2))
    );
    
    const result = await client.loadStaticPosts();
    
    assert.equal(result.meta.version, 1);
    assert.equal(result.meta.fetchedAt, "2026-09-22T10:00:00.000Z");
    assert.equal(result.meta.sort, "new");
    assert.equal(result.meta.limit, null);
    assert.equal(result.posts.length, 1);
    assert.equal(result.posts[0].title, "Test Post");
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
