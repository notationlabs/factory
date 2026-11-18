import { readFileSync } from "node:fs";
import type { Runtime } from "@notation/factory";

/** Droid, Factory's agent. `setup` installs its CLI, `droid`, in a container's image. Read lazily: an outpost's config, which has no filesystem, never touches it. */
export const runtime: Runtime = {
  id: "droid",
  get setup() {
    return readFileSync(new URL("../runtime/setup.sh", import.meta.url), "utf8");
  },
};
