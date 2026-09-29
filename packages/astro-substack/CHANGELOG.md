# astro-substack

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
