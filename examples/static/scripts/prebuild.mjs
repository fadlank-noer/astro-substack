// Import directly from source to avoid .astro component loading issues
// in Node.js runtime (prebuild script)
import { StaticSubstackInitiator } from "astro-substack/lib/substack/index.ts";

// Use process.cwd() — Astro dev/build always run with cwd = project root
const projectRoot = process.cwd();

const client = new StaticSubstackInitiator("https://fadlansthought.substack.com/", projectRoot);

console.log("Fetching Substack posts for static build...");

try {
  await client.saveStaticPosts({
    limit: 20,
    sort: "new",
  });
  console.log("✓ Static posts saved to __substack_rendered/posts.json");
} catch (error) {
  console.error("✗ Failed to fetch static posts:", error.message);
  process.exit(1);
}
