/**
 * Drift check (C3/R3): the CLI template is the canonical prebuild script; the
 * examples' scripts/prebuild.mjs must stay textually identical to it. The
 * README/example/CLI already drifted once (the README documented save()/load()
 * methods that never existed) — this test makes that failure loud.
 *
 * Run: node --test tests/drift.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { TEMPLATE } from "../cli/init.mjs";

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const EXAMPLES = ["static-shared-proxy", "static-own-proxy"];

test("example prebuild.mjs files are textually identical to the CLI template", async () => {
  for (const example of EXAMPLES) {
    const prebuild = join(
      PACKAGE_DIR,
      "..",
      "..",
      "examples",
      example,
      "scripts",
      "prebuild.mjs",
    );
    const content = await readFile(prebuild, "utf8");
    assert.equal(
      content,
      TEMPLATE,
      `examples/${example}/scripts/prebuild.mjs drifted from cli/init.mjs TEMPLATE — update both together`,
    );
  }
});

test("the canonical template carries the full env contract", () => {
  assert.ok(TEMPLATE.includes("SUBSTACK_PUBLICATION_URL"));
  assert.ok(TEMPLATE.includes("SUBSTACK_LIMIT"));
  assert.ok(TEMPLATE.includes("SUBSTACK_SORT"));
});

test("the canonical template carries the stale-file guard (R9)", () => {
  assert.ok(
    TEMPLATE.includes("rm(outputPath"),
    "template must remove stale posts.json before fetching",
  );
});
