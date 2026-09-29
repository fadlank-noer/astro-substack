// `Hello` is intentionally NOT re-exported here: a Node-runtime entry must never
// resolve a `.astro` file. Import it via the `astro-substack/astro` subpath instead.
export { SubstackInitiator, StaticSubstackInitiator } from "./lib/substack/index.ts";
export type { StaticPostsData, StaticPostsMetadata } from "./lib/substack/index.ts";
