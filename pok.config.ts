import { defineConfig } from "@pokit/core";
import { release } from "pok-plugins";

const published = (dir: string) => ({
  file: `packages/${dir}/package.json`,
  // There is no build step. The packages ship their TypeScript source.
  build: false as const,
});

export default defineConfig({
  appName: "factory",
  pmScripts: true,
  plugins: [
    release({
      // Lockstep: every package moves to the same version.
      packages: [
        published("factory"),
        published("cloudflare"),
        published("github"),
        published("slack"),
        published("claude"),
        published("railway"),
      ],
    }),
  ],
});
