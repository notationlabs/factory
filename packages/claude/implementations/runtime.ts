import type { Runtime } from "@notation/factory";

/** Installs Claude Code at image build, through the Dockerfile's `runtime` mount. */
export const runtime: Runtime = {
  id: "claude",
  // Read only where images are built. An outpost's config is evaluated where
  // modules have no file URL, so this isn't computed on load.
  get setup() {
    return new URL("../runtime/", import.meta.url).pathname;
  },
};
