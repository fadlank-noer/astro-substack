# astro-substack

## 0.2.1

### Patch Changes

- Strengthen the transient-failure retry: 5 attempts (was 3) with a 10s base delay (~100s of total backoff). Substack's rate-limit windows on shared proxy egress IPs can outlast a few seconds, so short backoffs still failed otherwise-green CI builds.

## 0.2.0

### Minor Changes

- [`e79f97f`](https://github.com/fadlank-noer/astro-substack/commit/e79f97f875a3541687261dfdc026dc14f68036d1) Thanks [@fadlank-noer](https://github.com/fadlank-noer)! - Fix the `init` CLI: the documented `npx astro-substack init --publication <url>` invocation was rejected with "Unknown argument: init", so scaffolding never ran; in layouts where the bin is reached through a symlink (e.g. pnpm on Windows) the entry-point check never matched and the bin exited silently. The bin now accepts the optional `init` subcommand, prints help for `help` / `-h` / `--help`, shows help when run with no arguments, and resolves its entry point through `realpath`.

- [`9efeaec`](https://github.com/fadlank-noer/astro-substack/commit/9efeaecc27f640048458b8e02eba9e767d5b2ffd) Thanks [@fadlank-noer](https://github.com/fadlank-noer)! - Add `proxyBaseUrl` option: routes the archive request through a fetch proxy (`<proxyBaseUrl>?url=<encoded upstream>`) for environments where Substack's Cloudflare returns 403 to direct requests from datacenter IPs — GitHub Actions runners and other CI (verified 2026-09-30; a browser User-Agent alone does not pass, and the RSS feed is blocked the same way). Retryable failures (HTTP 429/503, network errors) are retried with linear backoff honoring Retry-After, tunable via `retryDelayMs` (base 5s): Substack rate-limits shared proxy egress IPs and a transient 429 must not fail an otherwise-green build. Ships with a deployable Cloudflare Worker proxy under examples/worker-proxy and SUBSTACK_PROXY_URL support in the prebuild template.

### Patch Changes

- [`5e008a2`](https://github.com/fadlank-noer/astro-substack/commit/5e008a2e5f6578bf8ec8df1d044e36c3db77aa3f) Thanks [@fadlank-noer](https://github.com/fadlank-noer)! - Send a browser User-Agent on archive fetches: Substack's Cloudflare returns 403 to requests without a browser User-Agent when they originate from a datacenter IP (e.g. GitHub Actions runners), which broke static-build prebuilds in CI. Residential IPs were unaffected.

## 0.1.3

### Patch Changes

- 138d0d6: Add StaticSubstackInitiator for static prerender builds: saves fetched posts to __substack_rendered/posts.json via saveStaticPosts() and loads them via loadStaticPosts() for use in Astro frontmatter. Includes prebuild script example and updated README docs.
- Fix packaging so the package is installable from npm. The package previously shipped
  raw TypeScript, which Node refuses to load from `node_modules`
  (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`); only the in-repo example worked.

  BREAKING IMPORT CHANGE: the `astro-substack/lib/*` deep imports are removed. Use the
  package root instead:

      // before
      import { StaticSubstackInitiator } from "astro-substack/lib/substack/index.ts";
      // after
      import { StaticSubstackInitiator } from "astro-substack";

  The `Hello` component moved to the `astro-substack/astro` subpath.

  Also: add `meta.handle` to the static posts file so pages can read the configured
  publication without env access; ship a `npx astro-substack init` CLI that scaffolds the
  static prebuild script; and correct the README, which documented non-existent
  `save()` / `load()` methods.
