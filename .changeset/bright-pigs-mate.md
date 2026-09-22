---
"astro-substack": patch
---

Add StaticSubstackInitiator for static prerender builds: saves fetched posts to __substack_rendered/posts.json via saveStaticPosts() and loads them via loadStaticPosts() for use in Astro frontmatter. Includes prebuild script example and updated README docs.
