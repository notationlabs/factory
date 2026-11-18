import { defineConfig } from "@pokit/core";
import { release } from "pok-plugins";

// The packages ship their TypeScript source. The only build is the factory
// package's SDK, the modules that outposts' configs import in the deployer.
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
        published("cloudflare"),
        published("github"),
        published("slack"),
        published("claude"),
        published("droid"),
        published("railway"),
        published("cli"),
      ],
    }),
  ],
});
