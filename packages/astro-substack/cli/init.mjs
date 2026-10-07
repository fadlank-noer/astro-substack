#!/usr/bin/env node
// `npx astro-substack init` — scaffold an env-driven static prebuild script.
// Plain ESM, zero dependencies: a .mjs bin is immune to Node's refusal to
// type-strip .ts files under node_modules and runs on any Node version.

import { mkdir, writeFile, access, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const SORTS = ["new", "top", "pinned", "community"];

// Canonical template: kept textually identical to
// examples/static-shared-proxy/scripts/prebuild.mjs AND
// examples/static-own-proxy/scripts/prebuild.mjs — tests/drift.test.ts asserts
// equality, so the README example and the scaffolded file cannot drift apart
// (C3/R3).
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
       npx astro-substack proxy [options]

Scaffolds for env-driven static builds: a prebuild script that fetches your
Substack posts into __substack_rendered/, and a Cloudflare Worker fetch proxy
for CI/datacenter IPs, where Substack's Cloudflare 403-challenges direct
requests (the shared public proxy covers this too — deploy your own when you
don't want to share its traffic).

Commands:
  init                 Scaffold scripts/prebuild.mjs (optional; the bin only
                       does this, so "init" is accepted but not required)
  proxy                Scaffold worker-proxy/ (worker.mjs + wrangler.jsonc) —
                       YOUR own fetch proxy; deploy it with npx wrangler deploy
  help                 Show this help

Options:
  --publication <url>  Your Substack publication (required for init), e.g.
                       https://yourpub.substack.com/
  --limit <n>          Posts per build, 1-50 (Substack server-side max)
  --sort <value>       One of: new | top | pinned | community (default: new)
  --force              Overwrite existing scaffolded files
  -h, --help           Show this help

Running without any arguments also shows this help.

The script reads its configuration from the environment (.env / .env.local),
so after scaffolding, add your publication to .env:

  SUBSTACK_PUBLICATION_URL=<your publication url>
`;

/**
 * The fetch proxy shipped in examples/worker-proxy, embedded so `astro-substack
 * proxy` can scaffold it anywhere: it forwards only https://*.substack.com URLs
 * (never an open proxy) and returns the upstream response verbatim, which is
 * the contract the `proxy`/`proxyBaseUrl` options and SUBSTACK_PROXY_URL expect.
 */
export const PROXY_WORKER_TEMPLATE = `// Minimal fetch proxy for environments where Substack's Cloudflare
// 403-challenges direct requests from datacenter IPs — GitHub Actions runners,
// most CI, and your own VPS (verified 2026-09-30; a browser User-Agent does not
// help, and the RSS feed is blocked the same way, while the same requests pass
// from residential IPs).
//
// Usage:  https://<worker>/?url=<url-encoded absolute URL on *.substack.com>
// Contract: returns the upstream response verbatim (status + Content-Type),
// which is what astro-substack's proxy/proxyBaseUrl options expect.
//
// Restricted to https://*.substack.com so it is not an open proxy.

const ALLOWED_SUFFIX = ".substack.com";

// Matches the browser UA astro-substack sends on direct requests.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export default {
  async fetch(request) {
    const target = new URL(request.url).searchParams.get("url");
    if (!target) {
      return text(400, "Missing ?url=<url-encoded substack URL>");
    }

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return text(400, "Invalid url");
    }
    if (
      parsed.protocol !== "https:" ||
      !(parsed.hostname === \`www\${ALLOWED_SUFFIX}\` || parsed.hostname.endsWith(ALLOWED_SUFFIX))
    ) {
      return text(403, "Only https://*.substack.com URLs are proxied");
    }

    const upstream = await fetch(parsed, {
      headers: {
        Accept: "application/json, application/xml, text/xml, */*",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
    });

    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("Content-Type") ?? "application/octet-stream");
    // Never let the edge cache an upstream failure (a pinned 429 would outlive
    // the rate-limit window it reports).
    headers.set("Cache-Control", upstream.ok ? "public, max-age=300" : "no-store");
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function text(status, message) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
`;

export const PROXY_WRANGLER_TEMPLATE = `{
  "$schema": "https://unpkg.com/wrangler/config-schema.json",
  "name": "astro-substack-proxy",
  "main": "worker.mjs",
  "compatibility_date": "2026-08-24",
  "workers_dev": true,
  "observability": {
    "enabled": true
  }
}
`;

/**
 * Hand-rolled argv parsing — zero dependencies (C2).
 * Returns { args } on success or { error } on an unknown/missing-value token.
 * Accepts the `init` / `proxy` / `help` subcommands so the documented
 * invocations (`npx astro-substack init ...`, `npx astro-substack proxy`)
 * parse instead of failing as unknown.
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
      // Optional subcommand; the bin defaults to init.
      args.init = true;
    } else if (flag === "proxy") {
      args.proxy = true;
    } else if (valueFlags.includes(flag)) {
      const value = argv[i + 1];
      if (value === undefined) return { error: `Missing value for ${flag}` };
      args[flag.slice(2)] = value;
      i++;
    } else {
      return { error: `Unknown argument: ${flag}` };
    }
  }
  if (args.init && args.proxy) {
    return { error: "Pass either init or proxy, not both" };
  }
  return { args };
}

/**
 * `astro-substack proxy` — scaffold worker-proxy/ (worker.mjs + wrangler.jsonc)
 * into the caller's cwd so `npx wrangler deploy` ships the user's OWN fetch
 * proxy (same contract as examples/worker-proxy, minus the shared instance's
 * custom domain).
 */
async function proxyCommand(args) {
  for (const valueFlag of ["--publication", "--limit", "--sort"]) {
    if (args[valueFlag.slice(2)] !== undefined) {
      console.error(
        `${valueFlag} is not valid with the proxy command — it scaffolds a proxy worker, not a prebuild\n\n${USAGE}`,
      );
      process.exit(1);
    }
  }

  const dir = resolve(process.cwd(), "worker-proxy");
  const worker = join(dir, "worker.mjs");
  const wrangler = join(dir, "wrangler.jsonc");

  // No-overwrite by default: refuse and explain (D6/B-3).
  const existing = [];
  for (const target of [worker, wrangler]) {
    if (await access(target).then(() => true, () => false)) existing.push(target);
  }
  if (existing.length > 0 && !args.force) {
    console.error(
      existing.map((target) => `${target} already exists.`).join("\n") +
        "\nRefusing to overwrite. Review the file(s), then re-run with --force to replace them.\n",
    );
    process.exit(1);
  }

  await mkdir(dir, { recursive: true });
  await writeFile(worker, PROXY_WORKER_TEMPLATE);
  await writeFile(wrangler, PROXY_WRANGLER_TEMPLATE);

  console.log(`✓ Created ${worker}`);
  console.log(`✓ Created ${wrangler}`);
  console.log(
    "\nNext steps:\n\n" +
      "1. Deploy your own proxy (requires a free Cloudflare account):\n\n" +
      "     cd worker-proxy\n" +
      "     npx wrangler deploy\n\n" +
      "   Wrangler prints the URL, e.g.\n" +
      "   https://astro-substack-proxy.<your-subdomain>.workers.dev\n\n" +
      "2. Point the prebuild at YOUR proxy in .env:\n\n" +
      "     SUBSTACK_PROXY_URL=https://astro-substack-proxy.<your-subdomain>.workers.dev\n\n" +
      "   The worker only proxies https://*.substack.com URLs, so it is not an open proxy.\n" +
      "   For heavy CI use, attach a custom domain in Cloudflare — see the package\n" +
      '   README, "CI / datacenter IPs".\n',
  );
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
  if (args.proxy) {
    await proxyCommand(args);
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
