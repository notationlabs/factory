import { defineConfig } from "vite";
import { docs } from "@notation/docs";

// All options shown are required, except `defaultSlug` (not shown).
// Schema: ~/Repos/docs/packages/docs/src/options.ts
export default defineConfig({
  plugins: [
    docs({
      title: "lightbox",
      github: "https://github.com/notationlabs/lightbox",
      favicon:
        "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💡</text></svg>",
      categories: ["manual", "packages"], // slugs, in top-nav order; must match index.ts
      contentDirectory: ".", // the site lives inside the content it publishes
      pagesDirectory: "pages",
      logo: "./views/logo.tsx",
      // Resolved against the repo root
      version: { packageJson: "packages/lightbox/package.json" },
      deployment: {
        name: "lightbox-docs", // Cloudflare Worker name
        compatibilityDate: "2025-09-24",
        compatibilityFlags: ["nodejs_compat"],
      },
    }),
  ],
});
