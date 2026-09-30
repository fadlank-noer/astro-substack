/**
 * Tests for the `astro-substack init` bin.
 *
 * Run: node --test tests/cli-init.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(PACKAGE_DIR, "cli", "init.mjs");

function runInit(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

test("init --publication scaffolds scripts/prebuild.mjs with the env contract", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-init-"));

  try {
    const run = runInit(tmpDir, ["--publication", "https://testpub.substack.com/"]);
    assert.equal(run.status, 0, `init failed:\n${run.stderr}`);

    const generated = await readFile(join(tmpDir, "scripts", "prebuild.mjs"), "utf8");
    assert.ok(generated.includes("SUBSTACK_PUBLICATION_URL"));
    assert.ok(generated.includes("SUBSTACK_LIMIT"));
    assert.ok(generated.includes("SUBSTACK_SORT"));

    // D5: the bin prints the package.json script block instead of editing it.
    assert.ok(run.stdout.includes('"prebuild": "node scripts/prebuild.mjs"'));
    assert.ok(!generated.includes("testpub.substack.com"), "publication stays in .env, not hardcoded");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("init refuses to overwrite an existing prebuild.mjs without --force", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-init-"));

  try {
    const first = runInit(tmpDir, ["--publication", "https://testpub.substack.com/"]);
    assert.equal(first.status, 0, `first init failed:\n${first.stderr}`);

    const before = await readFile(join(tmpDir, "scripts", "prebuild.mjs"), "utf8");
    const second = runInit(tmpDir, ["--publication", "https://other.substack.com/"]);
    assert.notEqual(second.status, 0, "second init without --force must exit non-zero");
    assert.ok(second.stderr.includes("already exists"), `unexpected stderr: ${second.stderr}`);

    const after = await readFile(join(tmpDir, "scripts", "prebuild.mjs"), "utf8");
    assert.equal(after, before, "refused run must leave the file unchanged");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("init --force overwrites an existing prebuild.mjs", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-init-"));

  try {
    const first = runInit(tmpDir, ["--publication", "https://testpub.substack.com/"]);
    assert.equal(first.status, 0, `first init failed:\n${first.stderr}`);

    const forced = runInit(tmpDir, [
      "--publication",
      "https://other.substack.com/",
      "--force",
    ]);
    assert.equal(forced.status, 0, `forced init failed:\n${forced.stderr}`);

    const generated = await readFile(join(tmpDir, "scripts", "prebuild.mjs"), "utf8");
    assert.ok(generated.includes("SUBSTACK_PUBLICATION_URL"), "file must be rewritten");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("init writes only into the caller's cwd, never the package", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-init-"));

  try {
    const run = runInit(tmpDir, ["--publication", "https://testpub.substack.com/"]);
    assert.equal(run.status, 0, `init failed:\n${run.stderr}`);

    // EC9: the bin resolves its target from process.cwd(); the package tree
    // (and dist/) must stay untouched when invoked from elsewhere.
    const packageScripts = await access(join(PACKAGE_DIR, "scripts")).then(
      () => true,
      () => false,
    );
    assert.equal(packageScripts, false, "no scripts/ dir may appear in the package");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("init accepts the documented `init` subcommand", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-init-"));

  try {
    // README documents `npx astro-substack init --publication ...`; the
    // subcommand token must not be rejected as unknown.
    const run = runInit(tmpDir, ["init", "--publication", "https://testpub.substack.com/"]);
    assert.equal(run.status, 0, `init via subcommand failed:\n${run.stderr}`);

    const generated = await readFile(join(tmpDir, "scripts", "prebuild.mjs"), "utf8");
    assert.ok(generated.includes("SUBSTACK_PUBLICATION_URL"));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("no arguments, `help`, and -h all print the usage and exit 0", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-init-"));

  try {
    for (const args of [[], ["help"], ["-h"], ["--help"]]) {
      const run = runInit(tmpDir, args);
      assert.equal(run.status, 0, `args ${JSON.stringify(args)} must exit 0:\n${run.stderr}`);
      assert.ok(run.stdout.includes("Usage: npx astro-substack init"), `missing usage for ${JSON.stringify(args)}`);
      assert.ok(
        !existsSync(join(tmpDir, "scripts", "prebuild.mjs")),
        `help run ${JSON.stringify(args)} must not scaffold`,
      );
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("init without --publication still errors when other args are given", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-init-"));

  try {
    const run = runInit(tmpDir, ["init"]);
    assert.notEqual(run.status, 0, "init alone must still demand --publication");
    assert.ok(run.stderr.includes("--publication is required"));
    assert.ok(run.stderr.includes("Usage: npx astro-substack init"));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("init rejects unknown flags and invalid values", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "astro-substack-init-"));

  try {
    const unknown = runInit(tmpDir, ["--publication", "https://x.substack.com/", "--bogus"]);
    assert.notEqual(unknown.status, 0, "unknown flag must exit non-zero");
    assert.ok(unknown.stderr.includes("Unknown argument: --bogus"));

    const badSort = runInit(tmpDir, [
      "--publication",
      "https://x.substack.com/",
      "--sort",
      "newest",
    ]);
    assert.notEqual(badSort.status, 0, "invalid sort must exit non-zero");
    assert.ok(badSort.stderr.includes("--sort must be one of"));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
