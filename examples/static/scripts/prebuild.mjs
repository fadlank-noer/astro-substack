// Env-driven prebuild for the Astro static build.
// Config is read from the environment, loaded from .env / .env.local by the
// zero-dependency loader below (Node's --env-file flag cannot be used in
// NODE_OPTIONS, so it would be silently lost in CI and Docker).

import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";

// --- minimal .env loader -----------------------------------------------------
// process.env wins, so CI and shell overrides always take precedence.
async function loadEnv() {
  for (const file of [".env", ".env.local"]) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}
// -----------------------------------------------------------------------------

await loadEnv();

// Fail fast rather than silently fetching someone else's publication (D4).
const handle = process.env.SUBSTACK_PUBLICATION_URL;
if (!handle) {
  console.error(
    "SUBSTACK_PUBLICATION_URL is not set.\n" +
      "Add it to .env:\n\n" +
      "  SUBSTACK_PUBLICATION_URL=https://yourpub.substack.com/\n",
  );
  process.exit(1);
}

const limit = process.env.SUBSTACK_LIMIT ? Number(process.env.SUBSTACK_LIMIT) : undefined;
const sort = process.env.SUBSTACK_SORT || "new";

// Warn on values the library would silently coerce (EC5 / GRILLING C-2).
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) {
  console.warn(
    `! SUBSTACK_LIMIT=${process.env.SUBSTACK_LIMIT} is out of range; ` +
      `Substack's server-side max is 50, so 50 posts will be fetched.`,
  );
}

const projectRoot = process.cwd();
const outputPath = join(projectRoot, "__substack_rendered", "posts.json");

// Remove stale output BEFORE fetching: if the fetch fails, a build would otherwise
// succeed against the previous run's posts and silently serve the wrong content.
await rm(outputPath, { force: true });

const { StaticSubstackInitiator } = await import("astro-substack");

console.log(`Fetching Substack posts for static build (${handle}, sort=${sort})...`);

try {
  await new StaticSubstackInitiator(handle, projectRoot).saveStaticPosts({ limit, sort });
  console.log("✓ Static posts saved to __substack_rendered/posts.json");
} catch (error) {
  console.error("✗ Failed to fetch static posts:", error.message);
  process.exit(1);
}
