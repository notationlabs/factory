import type { DocCategory } from "@notation/docs/config";

export const packages: DocCategory = {
  label: "Packages",
  slug: "packages",
  sections: [
    {
      heading: "Entrypoints",
      icon: "terminal",
      links: [
        { label: "@lightbox/cli", slug: "packages/cli" },
        { label: "lightbox", slug: "packages/core" },
      ],
    },
    {
      heading: "Plugins",
      icon: "cpu",
      links: [
        { label: "@lightbox/github", slug: "packages/github" },
        { label: "@lightbox/slack", slug: "packages/slack" },
        { label: "@lightbox/claude", slug: "packages/claude" },
        { label: "@lightbox/cloudflare", slug: "packages/cloudflare" },
        { label: "@lightbox/railway", slug: "packages/railway" },
      ],
    },
  ],
};
