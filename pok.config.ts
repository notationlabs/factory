import { defineConfig } from "@pokit/core";
import { docs } from "pok-plugins";

// Mounts `pok docs dev|build|deploy`, which run `pnpm exec docs <cmd>` in ./docs.
export default defineConfig({
  pmScripts: true,
  plugins: [docs({ name: "lightbox-docs" })],
});
