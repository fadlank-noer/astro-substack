/**
 * Real-install smoke test — the B1 hard gate.
 *
 * The in-repo example resolves astro-substack through a workspace symlink whose
 * realpath escapes node_modules, so it passes even when the published package is
 * broken (Node refuses to type-strip .ts files under node_modules —
 * ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). Only a real install layout
 * reproduces that failure, so this test packs the package, unpacks the tarball
 * into a throwaway consumer's node_modules, and asserts the import resolves.
 *
 * Run: node --test tests/real-install.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

test("packed tarball imports from a real node_modules layout", { timeout: 120_000 }, async () => {
  const tmp = await mkdtemp(join(tmpdir(), "astro-substack-real-install-"));
  const consumer = join(tmp, "consumer");
  const modules = join(consumer, "node_modules");
  const installed = join(modules, "astro-substack");

  try {
    await mkdir(modules, { recursive: true });

    // 1. Pack the package from its real files allowlist.
    const pack = spawnSync(
      "npm",
      ["pack", "--pack-destination", tmp],
      { cwd: PACKAGE_DIR, encoding: "utf8", shell: process.platform === "win32" },
    );
    assert.equal(pack.status, 0, `npm pack failed:\n${pack.stderr}`);

    const tarballs = (await readdir(tmp)).filter((f) => f.endsWith(".tgz"));
    assert.equal(tarballs.length, 1, `expected one tarball, got: ${tarballs.join(", ")}`);

    // 2. Unpack beside the tarball (its root folder is "package/") and move it
    //    into the consumer's node_modules, reproducing the npm/yarn
    //    registry-copy layout. The tarball is passed as a bare relative
    //    filename with cwd=tmp: GNU tar treats "C:" in an absolute path as a
    //    remote host ("Cannot connect to C: resolve failed"), and a relative
    //    name works for both GNU tar and Windows bsdtar.
    const untar = spawnSync("tar", ["-xzf", tarballs[0]], {
      cwd: tmp,
      encoding: "utf8",
    });
    assert.equal(untar.status, 0, `tar extraction failed:\n${untar.stderr}`);
    renameSync(join(tmp, "package"), installed);

    // 3. A consumer script imports the package root the way the README documents.
    const consumerScript = join(consumer, "prebuild.mjs");
    await writeFile(
      consumerScript,
      [
        'import { StaticSubstackInitiator } from "astro-substack";',
        'console.log("CONSUMER OK: StaticSubstackInitiator =", typeof StaticSubstackInitiator);',
        "",
      ].join("\n"),
    );

    const run = spawnSync(process.execPath, [consumerScript], {
      cwd: consumer,
      encoding: "utf8",
    });

    // 4. The import must resolve and yield the class constructor.
    assert.equal(
      run.status,
      0,
      `consumer import failed (status ${run.status}):\nstdout: ${run.stdout}\nstderr: ${run.stderr}`,
    );
    assert.ok(
      run.stdout.includes("StaticSubstackInitiator"),
      `expected StaticSubstackInitiator in stdout, got: ${run.stdout}`,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
