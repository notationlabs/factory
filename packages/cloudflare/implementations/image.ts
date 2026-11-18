import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Runtime } from "@notation/factory";
import { findProjectRoot } from "@notation/core/paths";

const IMAGE_DIR = fileURLToPath(new URL("../image/", import.meta.url));

/**
 * Writes the build context of the hub's outpost image, and returns its path
 * relative to the project root, as Notation takes it:
 * 1. The Dockerfile, from this package.
 * 2. Each runtime's setup directory, as `runtimes/<id>/`, and
 *    `runtimes/setup.sh`, which runs each one's `setup.sh`.
 * Deploy hashes the context's files, so the image is only rebuilt when one
 * of them changes.
 */
export const outpostImage = (id: string, runtimes: Runtime[]) => {
  const relative = `node_modules/.cache/notation-factory/${id}`;
  const context = join(findProjectRoot(process.cwd()), relative);
  rmSync(context, { recursive: true, force: true });
  mkdirSync(join(context, "runtimes"), { recursive: true });
  cpSync(join(IMAGE_DIR, "Dockerfile"), join(context, "Dockerfile"));
  const setup = ["#!/bin/sh", "set -eu"];
  for (const runtime of runtimes) {
    cpSync(runtime.setup, join(context, "runtimes", runtime.id), { recursive: true });
    setup.push(`(cd "$(dirname "$0")/${runtime.id}" && sh ./setup.sh)`);
  }
  writeFileSync(join(context, "runtimes", "setup.sh"), `${setup.join("\n")}\n`, { mode: 0o755 });
  return relative;
};
