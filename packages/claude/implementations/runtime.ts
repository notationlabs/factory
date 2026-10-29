import type { Runtime } from "factory";

/** Installs Claude Code at image build, through the Dockerfile's `runtime` mount. */
export const runtime: Runtime = {
  id: "claude",
  setup: new URL("../runtime/", import.meta.url).pathname,
};
