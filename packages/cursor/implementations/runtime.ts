import { readFileSync } from "node:fs";
import type { Runtime } from "@notation/factory";

/** Cursor Agent. `setup` installs its CLI, `agent`, in a container's image, and `runner` is how the runner runs it. Both are read lazily: an outpost's config, which has no filesystem, never touches them. */
export const runtime: Runtime = {
  id: "cursor",
  get setup() {
    return readFileSync(new URL("../runtime/setup.sh", import.meta.url), "utf8");
  },
  get runner() {
    return readFileSync(new URL("../runtime/runner.ts", import.meta.url), "utf8");
  },
};
