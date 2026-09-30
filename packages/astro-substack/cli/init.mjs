#!/usr/bin/env node
// `npx astro-substack init` — scaffold an env-driven static prebuild script.
// Plain ESM, zero dependencies: a .mjs bin is immune to Node's refusal to
// type-strip .ts files under node_modules and runs on any Node version.

import { mkdir, writeFile, access, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SORTS = ["new", "top", "pinned", "community"];

// Canonical template: kept textually identical to
// examples/static/scripts/prebuild.mjs — tests/drift.test.ts asserts equality,
// so the README example and the scaffolded file cannot drift apart (C3/R3).
export const TEMPLATE = `// Env-driven prebuild for the Astro static build.
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
    for (const raw of text.split(/\\r?\\n/)) {
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
    "SUBSTACK_PUBLICATION_URL is not set.\\n" +
      "Add it to .env:\\n\\n" +
      "  SUBSTACK_PUBLICATION_URL=https://yourpub.substack.com/\\n",
  );
  process.exit(1);
}

const limit = process.env.SUBSTACK_LIMIT ? Number(process.env.SUBSTACK_LIMIT) : undefined;
const sort = process.env.SUBSTACK_SORT || "new";

// Optional: route the fetch through a proxy for environments where Substack's
// Cloudflare 403-challenges direct requests (CI runners on datacenter IPs).
// The bundled Cloudflare Worker proxy lives in examples/worker-proxy.
const proxyBaseUrl = process.env.SUBSTACK_PROXY_URL || undefined;

// Warn on values the library would silently coerce (EC5 / GRILLING C-2).
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) {
  console.warn(
    \`! SUBSTACK_LIMIT=\${process.env.SUBSTACK_LIMIT} is out of range; \` +
      \`Substack's server-side max is 50, so 50 posts will be fetched.\`,
  );
}

const projectRoot = process.cwd();
const outputPath = join(projectRoot, "__substack_rendered", "posts.json");

// Remove stale output BEFORE fetching: if the fetch fails, a build would otherwise
// succeed against the previous run's posts and silently serve the wrong content.
await rm(outputPath, { force: true });

const { StaticSubstackInitiator } = await import("astro-substack");

console.log(\`Fetching Substack posts for static build (\${handle}, sort=\${sort})...\`);

try {
  await new StaticSubstackInitiator(handle, projectRoot).saveStaticPosts({
    limit,
    sort,
    proxyBaseUrl,
  });
  console.log("✓ Static posts saved to __substack_rendered/posts.json");
} catch (error) {
  console.error("✗ Failed to fetch static posts:", error.message);
  process.exit(1);
}
`;

const USAGE = `Usage: npx astro-substack init --publication <url> [options]

Scaffold scripts/prebuild.mjs — an env-driven script that fetches your
Substack posts into __substack_rendered/ before an Astro static build.

Commands:
  init                 Scaffold scripts/prebuild.mjs (optional; the bin only
                       does this, so "init" is accepted but not required)
  help                 Show this help

Options:
  --publication <url>  Your Substack publication (required), e.g.
                       https://yourpub.substack.com/
  --limit <n>          Posts per build, 1-50 (Substack server-side max)
  --sort <value>       One of: new | top | pinned | community (default: new)
  --force              Overwrite an existing scripts/prebuild.mjs
  -h, --help           Show this help

Running without any arguments also shows this help.

The script reads its configuration from the environment (.env / .env.local),
so after scaffolding, add your publication to .env:

  SUBSTACK_PUBLICATION_URL=<your publication url>
`;

/**
 * Hand-rolled argv parsing — zero dependencies (C2).
 * Returns { args } on success or { error } on an unknown/missing-value token.
 * Accepts the `init` / `help` subcommands so the documented invocation
 * (`npx astro-substack init ...`) parses instead of failing as unknown.
 */
export function parseArgs(argv) {
  const args = { force: false };
  const valueFlags = ["--publication", "--limit", "--sort"];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--help" || flag === "-h" || flag === "help") {
      args.help = true;
    } else if (flag === "--force") {
      args.force = true;
    } else if (flag === "init") {
      // Optional subcommand; the bin has no other behavior.
    } else if (valueFlags.includes(flag)) {
      const value = argv[i + 1];
      if (value === undefined) return { error: `Missing value for ${flag}` };
      args[flag.slice(2)] = value;
      i++;
    } else {
      return { error: `Unknown argument: ${flag}` };
    }
  }
  return { args };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0) {
    console.log(USAGE);
    return;
  }
  const { args, error } = parseArgs(argv);
  if (error) {
    console.error(`${error}\n\n${USAGE}`);
    process.exit(1);
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (!args.publication) {
    console.error(`--publication is required\n\n${USAGE}`);
    process.exit(1);
  }
  if (/\s/.test(args.publication)) {
    console.error(`--publication must be a single URL or handle, got: ${args.publication}`);
    process.exit(1);
  }
  if (args.limit !== undefined && (!/^\d+$/.test(args.limit) || Number(args.limit) < 1)) {
    console.error(`--limit must be a positive integer, got: ${args.limit}`);
    process.exit(1);
  }
  if (args.sort !== undefined && !SORTS.includes(args.sort)) {
    console.error(`--sort must be one of: ${SORTS.join(" | ")}, got: ${args.sort}`);
    process.exit(1);
  }

  const target = resolve(process.cwd(), "scripts", "prebuild.mjs");

  // No-overwrite by default: refuse and explain (D6/B-3).
  const exists = await access(target).then(
    () => true,
    () => false,
  );
  if (exists && !args.force) {
    console.error(
      `${target} already exists.\n` +
        "Refusing to overwrite it. Review the file, then re-run with --force to replace it.\n",
    );
    process.exit(1);
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, TEMPLATE);

  const envLines = [`SUBSTACK_PUBLICATION_URL=${args.publication}`];
  if (args.limit !== undefined) envLines.push(`SUBSTACK_LIMIT=${args.limit}`);
  if (args.sort !== undefined) envLines.push(`SUBSTACK_SORT=${args.sort}`);

  console.log(`✓ Created ${target}`);
  console.log(
    "\nNext steps:\n\n" +
      "1. Add your configuration to .env (already gitignored):\n\n" +
      envLines.map((line) => `     ${line}`).join("\n") +
      "\n\n2. Wire the script into package.json:\n\n" +
      '  "scripts": {\n' +
      '    "prebuild": "node scripts/prebuild.mjs",\n' +
      '    "build": "npm run prebuild && astro build",\n' +
      '    "dev": "npm run prebuild && astro dev"\n' +
      "  }\n",
  );
}

// Run only when executed directly, so tests can import parseArgs/TEMPLATE.
// Also compare the resolved real path: npm/pnpm bin shims (notably on Windows)
// may reach this file through a symlink, and then a raw argv[1] comparison
// never matches — the bin would exit 0 without printing anything.
async function isDirectRun() {
  if (process.argv[1] === undefined) return false;
  const { pathToFileURL } = await import("node:url");
  const entry = resolve(process.argv[1]);
  if (import.meta.url === pathToFileURL(entry).href) return true;
  try {
    return import.meta.url === pathToFileURL(await realpath(entry)).href;
  } catch {
    return false;
  }
}

if (await isDirectRun()) {
  await main();
}
