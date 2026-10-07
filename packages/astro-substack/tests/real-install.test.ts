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
import {
  mkdtemp,
  readdir,
  rm,
  writeFile,
  mkdir,
  readFile,
  stat,
  cp,
  realpath,
} from "node:fs/promises";
import { renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Copy the runtime dependency `name` (and its transitive runtime deps) into
 * the consumer's node_modules, dereferencing the store symlinks pnpm uses —
 * simulating what a package manager does for the tarball's dependencies
 * while keeping this gate offline and deterministic. Deliberately stat-based:
 * resolving by name can trip over dependencies whose `exports` map has no
 * CJS entry, and the physical layout is all this simulation needs.
 */
async function seedDependency(
  name: string,
  fromDir: string,
  modulesDir: string,
  seen = new Set<string>(),
): Promise<void> {
  if (seen.has(name)) return;
  seen.add(name);
  // The dependency sits either in the seeding package's own node_modules
  // (package-root layout) or beside it under the per-package node_modules of
  // a pnpm store entry (…/.pnpm/<pkg>@<version>/node_modules/<dep>).
  const candidates = [
    join(fromDir, "node_modules", name),
    join(dirname(fromDir), name),
  ];
  let depDir: string | undefined;
  for (const candidate of candidates) {
    try {
      await stat(join(candidate, "package.json"));
      depDir = await realpath(candidate);
      break;
    } catch {
      // try the next layout
    }
  }
  if (!depDir) {
    throw new Error(`cannot locate dependency ${name} seeded from ${fromDir}`);
  }
  await mkdir(modulesDir, { recursive: true });
  await cp(depDir, join(modulesDir, name), { recursive: true, dereference: true });
  const manifest = JSON.parse(await readFile(join(depDir, "package.json"), "utf8"));
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    await seedDependency(dep, depDir, modulesDir, seen);
  }
}

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

    // 2.5 Seed the package's runtime dependencies beside it — the unpacked
    //     tarball is the package alone, while a real install also places its
    //     dependencies in node_modules (the package root imports
    //     fast-xml-parser transitively via the feed module).
    const manifest = JSON.parse(
      await readFile(join(PACKAGE_DIR, "package.json"), "utf8"),
    );
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      await seedDependency(name, PACKAGE_DIR, modules);
    }

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
