import type { DocsSite } from "@notation/docs";

export default {
  slug: "factory",
  label: "Software Factory",
  root: new URL(".", import.meta.url),
  version: { packageJson: "packages/factory/package.json" },
  categories: [
    {
      label: "User Manual",
      slug: "manual",
      sections: [
        {
          heading: "Getting Started",
          icon: "rocket",
          links: [
            { label: "Introduction", slug: "manual/introduction" },
            { label: "Installation", slug: "manual/installation" },
            { label: "Quick Start", slug: "manual/quickstart" },
          ],
        },
        {
          heading: "The Hub",
          icon: "cloud",
          links: [
            { label: "Declaring Infra", slug: "manual/infra" },
            { label: "Connections & Channels", slug: "manual/connections" },
            { label: "Container Providers", slug: "manual/providers" },
            { label: "Secrets & Vaults", slug: "manual/secrets" },
            { label: "Writing Plugins", slug: "manual/plugins" },
          ],
        },
        {
          heading: "Outposts",
          icon: "layers",
          links: [
            { label: "Declaring Outposts", slug: "manual/outposts" },
            { label: "Agents & Triggers", slug: "manual/agents-and-triggers" },
            { label: "Worktrees & Sessions", slug: "manual/worktrees" },
            { label: "Containers & Policies", slug: "manual/containers" },
          ],
        },
        {
          heading: "Working with Agents",
          icon: "terminal",
          links: [
            { label: "Conversations & Sessions", slug: "manual/github-usage" },
            { label: "CLI Reference", slug: "manual/cli" },
          ],
        },
      ],
    },
    {
      label: "Packages",
      slug: "packages",
      sections: [
        {
          heading: "Entrypoints",
          icon: "terminal",
          links: [
            { label: "@factory/cli", slug: "packages/cli" },
            { label: "factory", slug: "packages/core" },
          ],
        },
        {
          heading: "Plugins",
          icon: "cpu",
          links: [
            { label: "@factory/github", slug: "packages/github" },
            { label: "@factory/slack", slug: "packages/slack" },
            { label: "@factory/claude", slug: "packages/claude" },
            { label: "@factory/cloudflare", slug: "packages/cloudflare" },
            { label: "@factory/railway", slug: "packages/railway" },
          ],
        },
      ],
    },
  ],
} satisfies DocsSite;
