---
"astro-substack": minor
---

Add fetchPublications() to SubstackInitiator: fetch public posts from any Substack publication via the unofficial /api/v1/archive endpoint. Supports limit (omitted = all posts; invalid values fall back to the server-side max of 50), sort (new | top | pinned | community), and timeoutMs. Ships typed results (SubstackPublicationPost), node:test unit tests, an opt-in live API test, and full usage docs in the package README.
