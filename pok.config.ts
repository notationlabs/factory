import { defineConfig } from "@pokit/core";
import { release } from "pok-plugins";

// The packages ship their TypeScript source. Two files are generated and
// gitignored, so each release must build them: the factory package's SDK,
// which outposts' configs import in the deployer, and the cloudflare
// package's outpost Worker bundle, which holds the runner.
const published = (dir: string, build: string | false = false) => ({
  file: `packages/${dir}/package.json`,
  build,
});

export default defineConfig({
  appName: "factory",
  pmScripts: true,
  plugins: [
    release({
      // Lockstep: every package moves to the same version.
      packages: [
        published("factory", "pnpm build:sdk"),
        published("cloudflare", "pnpm build:outpost"),
        published("github"),
        published("slack"),
        published("claude"),
        published("cursor"),
        published("droid"),
        published("railway"),
        published("cli"),
      ],
    }),
  ],
});
