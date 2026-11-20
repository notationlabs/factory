# Introduction

Notation Factory runs coding agents in remote containers triggered by events in your GitHub repositories. Declare your organization's shared hub once, then connect individual repositories as outposts with their own containers, agent profiles, and permissions.

## The hub

An organization deploys one shared hub in `factory.infra.ts` alongside its Notation project config:

::code-group

```ts [factory.infra.ts]
import * as claude from "@notation/factory-claude";
import * as cloudflare from "@notation/factory-cloudflare";
import * as github from "@notation/factory-github";
import { sources } from "@notation/std/resources";

const vault = new cloudflare.Vault("vault");
const router = new cloudflare.Router("router", { vault });

const gh = new github.Connection("gh", { org: "acme", router });
new github.CodeHost("github", { connection: gh, allow: [{ owner: "acme" }] });
new github.OperatorAuth("operators", { connection: gh, users: ["alice"] });

const claudeToken = new sources.Env("claude-oauth-token", {
  config: { key: "CLAUDE_CODE_OAUTH_TOKEN", track: "scrypt" },
});
const claudeAccount = new claude.Account("claude", {
  auth: vault.secret({
    id: "claude-oauth-token",
    value: claudeToken.credentials.value,
  }),
});

new cloudflare.Deployer("deployer", {
  router,
  vault,
  accounts: [claudeAccount],
});
```

```ts [notation.config.ts]
import { defineConfig } from "@notation/core/config";

export default defineConfig({
  app: "acme-factory",
  entry: "factory.infra.ts",
  defaultStage: "prod",
});
```

::

Each hub groups four concerns:

- **Vault** – Stores encrypted secrets and binds each credential only to the service that needs it.
- **Router** – Receives GitHub webhook events, checks trigger rules, and relays replies back to threads.
- **Connections and accounts** – Registers your GitHub App, repository allowlist, operator access list, and agent credentials.
- **Deployer** – Evaluates outpost configs, builds container images, and starts agent runs.

## Outposts

Each repository defines its own outpost in `.factory/infra.ts` without naming the hub's cloud provider:

```ts [.factory/infra.ts]
import { Container, Trigger } from "@notation/factory";
import * as claude from "@notation/factory-claude";
import * as github from "@notation/factory-github";

const gh = github.Connection.get("gh").channel({ id: "issues" });

const code = new github.Policy("code", {
  permissions: { contents: "write", pull_requests: "write" },
});

const dev = new Container("dev", {
  runtimes: [claude.runtime],
  policies: [code],
});

const coder = new claude.Agent("coder", {
  model: "claude-opus-5-5",
  effort: "high",
});

new Trigger("mention", {
  event: gh.issueComment({
    mention: "@claude",
    from: github.collaborators(),
  }),
  worktree: (event) => `issue-${event.issue.number}`,
  agent: coder,
  container: dev,
});
```

When a collaborator comments `@claude` on an issue, Factory checks out the named branch in a container worktree, runs `coder` with a scoped repository token, and posts the reply back to the issue. See [Declaring Outposts](./outposts.md).

## Deploy and subscribe

Deploy the hub with `factory infra up`, then run `factory repo install` inside each repository you want to serve. Once subscribed, pushing updates under `.factory/` on the default branch rebuilds and updates that repository's outpost automatically. See [Quickstart](./quickstart.md).

## Supported packages

Factory separates the CLI, core contracts, hub provider, GitHub integration, and agent runtimes into dedicated packages:

| Package | Role |
| :--- | :--- |
| `@notation/factory` | Core outpost resources, secret declarations, and plugin contracts |
| `@notation/factory-cli` | The `factory` command-line tool for hubs and repositories |
| `@notation/factory-cloudflare` | Hub router, deployer, vault, and container hosting on Cloudflare |
| `@notation/factory-github` | GitHub App connections, issue triggers, code host, and policies |
| `@notation/factory-claude` | Claude Code account, runtime installer, and agent config |
| `@notation/factory-cursor` | Cursor Agent account, runtime installer, and agent config |
| `@notation/factory-droid` | Droid account, runtime installer, and agent config |
