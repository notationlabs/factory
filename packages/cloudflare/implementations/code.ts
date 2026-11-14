import { fileURLToPath } from "node:url";
import { toProjectRoot } from "@notation/core/paths";
import { fs } from "@notation/std/resources";

/** The compatibility date of the hub's Workers. */
export const COMPATIBILITY_DATE = "2026-10-12";

/**
 * The bundle of one of the hub's Workers, which this package ships at
 * `dist/<worker>/index.mjs`. The path is kept relative to the project root,
 * as `WorkerScript` expects.
 */
export const workerCode = (id: string, worker: "router" | "deployer") =>
  new fs.File(`${id}-code`, {
    config: {
      filePath: toProjectRoot(
        fileURLToPath(new URL(`../dist/${worker}/index.mjs`, import.meta.url)),
      ),
    },
  });

/**
 * The build context of the router's container image, which this package
 * ships at `router-image/`, relative to the project root.
 */
export const routerImageContext = () =>
  toProjectRoot(fileURLToPath(new URL("../router-image", import.meta.url)));
