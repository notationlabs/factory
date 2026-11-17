import { fileURLToPath } from "node:url";
import { bundle } from "@notation/build/resources";

/** The compatibility date of the hub's Workers. */
export const COMPATIBILITY_DATE = "2026-10-12";

/** The code of one of the hub's Workers, from `workers/<worker>.ts` in this package, which deploy bundles. */
export const workerBundle = (
  id: string,
  worker: "router" | "deployer" | "channel",
  modules?: Record<string, string>,
) =>
  bundle({
    id,
    platform: "workerd",
    entry: fileURLToPath(new URL(`../workers/${worker}.ts`, import.meta.url)),
    modules,
  });
