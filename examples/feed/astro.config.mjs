import { defineConfig } from 'astro/config';

// Static output: the feed fetch below runs server-side (at build/dev),
// so Substack's missing CORS headers are not a problem.
export default defineConfig({
  output: 'static',
});
