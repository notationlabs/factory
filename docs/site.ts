import type { DocsSite } from "@notation/docs";

export default {
  slug: "factory",
  label: "Factory",
  root: new URL(".", import.meta.url),
  defaultSlug: "core/introduction",
  version: { packageJson: "packages/factory/package.json" },
  categories: [
    {
      label: "Core",
      slug: "core",
      sections: [
        {
          heading: "Getting Started",
          icon: "rocket",
          links: [
            { label: "Introduction", slug: "core/introduction" },
            { label: "Installation", slug: "core/installation" },
            { label: "Quickstart", slug: "core/quickstart" },
          ],
        },
        {
          heading: "The Hub",
          icon: "cloud",
          links: [
            { label: "Declaring Infra", slug: "core/infra" },
            { label: "Cloudflare Provider", slug: "core/cloudflare" },
            { label: "Secrets", slug: "core/secrets" },
          ],
        },
        {
          heading: "Outposts",
          icon: "layers",
          links: [
            { label: "Declaring Outposts", slug: "core/outposts" },
            { label: "Containers & Policies", slug: "core/containers" },
            { label: "Agents", slug: "core/agents" },
            { label: "Triggers & Worktrees", slug: "core/triggers-and-worktrees" },
          ],
        },
        {
          heading: "CLI",
          icon: "terminal",
          links: [{ label: "CLI Guide", slug: "core/cli" }],
        },
      ],
    },
    {
      label: "Authoring",
      slug: "authoring",
      sections: [
        {
          heading: "Plugins",
          icon: "layers",
          links: [
            { label: "Plugin Overview", slug: "authoring/plugins" },
            { label: "Hub Providers", slug: "authoring/providers" },
            { label: "Channels & Code Hosts", slug: "authoring/channels-and-hosts" },
            { label: "Agent Runtimes", slug: "authoring/runtimes" },
          ],
        },
      ],
    },
    {
      label: "Reference",
      slug: "reference",
      sections: [
        {
          heading: "Core & CLI",
          icon: "terminal",
          links: [
            { label: "@notation/factory", slug: "reference/factory" },
            { label: "@notation/factory-cli", slug: "reference/cli" },
          ],
        },
        {
          heading: "Providers",
          icon: "cloud",
          links: [
            { label: "@notation/factory-cloudflare", slug: "reference/cloudflare" },
            { label: "@notation/factory-railway", slug: "reference/railway" },
          ],
        },
        {
          heading: "Channels & Runtimes",
          icon: "cpu",
          links: [
            { label: "@notation/factory-github", slug: "reference/github" },
            { label: "@notation/factory-slack", slug: "reference/slack" },
            { label: "@notation/factory-claude", slug: "reference/claude" },
            { label: "@notation/factory-cursor", slug: "reference/cursor" },
            { label: "@notation/factory-droid", slug: "reference/droid" },
          ],
        },
      ],
    },
    {
      label: "Internals",
      slug: "internals",
      sections: [
        {
          heading: "Overview",
          icon: "layers",
          links: [{ label: "Architecture", slug: "internals/architecture" }],
        },
        {
          heading: "Router & Delivery",
          icon: "cpu",
          links: [
            { label: "Routing & Deliveries", slug: "internals/routing-and-deliveries" },
            { label: "Security & Tickets", slug: "internals/security-and-tickets" },
          ],
        },
        {
          heading: "Deployer & Builds",
          icon: "cloud",
          links: [
            { label: "Outpost Config Evaluation", slug: "internals/outpost-evaluation" },
            { label: "Cloudflare Outpost Builds", slug: "internals/cloudflare-builds" },
          ],
        },
        {
          heading: "Container Runner",
          icon: "terminal",
          links: [
            { label: "Runner Execution & Prompts", slug: "internals/runner-execution" },
            { label: "Worktrees & Session State", slug: "internals/worktree-and-session-state" },
          ],
        },
      ],
    },
  ],
} satisfies DocsSite;
