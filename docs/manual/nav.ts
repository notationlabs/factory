import type { DocCategory } from "@notation/docs/config";

// Each category owns a nav.ts beside its Markdown.
// A page is unreachable until registered here.
export const manual: DocCategory = {
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
};
