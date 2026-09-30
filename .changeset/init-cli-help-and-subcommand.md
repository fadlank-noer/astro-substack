---
"astro-substack": minor
---

Fix the `init` CLI: the documented `npx astro-substack init --publication <url>` invocation was rejected with "Unknown argument: init", so scaffolding never ran; in layouts where the bin is reached through a symlink (e.g. pnpm on Windows) the entry-point check never matched and the bin exited silently. The bin now accepts the optional `init` subcommand, prints help for `help` / `-h` / `--help`, shows help when run with no arguments, and resolves its entry point through `realpath`.
