# Notation Factory

Notation Factory runs coding agents in remote containers. It starts an agent when an event arrives on a channel your team uses, such as a GitHub issue or pull request.

You declare the infrastructure in TypeScript and deploy it with [Notation](https://github.com/notationlabs/notation).

## Hub and outposts

An organisation runs one central hub and one outpost per repository.

| Side | Purpose |
| --- | --- |
| `factory.infra.ts` | Hub deployed with Notation declaring a router, deployer, vault, connections, and agent accounts |
| `.factory/infra.ts` | Repository outpost applied by the hub's deployer declaring channels, containers, policies, agents, and triggers |

The router receives events from each connection. The deployer provisions containers. The vault holds secrets, and the router and deployer each bind only the secrets they use. Each secret takes a Notation [credential](https://github.com/notationlabs/notation/blob/main/docs/core/secrets.md) from a source such as `sources.Env` in `@notation/std/resources` or an API key issued by a resource.

## Plugins

`@notation/factory` defines contracts for each part of a hub and an outpost, and plugins implement those contracts for a particular service:

| Contracts | Plugins today |
| --- | --- |
| `Vault`, `Router`, `Deployer` | `factory-cloudflare` |
| `Connection`, `Channel`, `CodeHost`, `Policy` | `factory-github` |
| `OperatorAuth` | `factory-github` |
| `Account`, `Agent`, `runtime` | `factory-claude`, `factory-cursor`, `factory-droid` |

An outpost's `.factory/infra.ts` does not name the hosting provider, so the hub can move between providers without changing repository configs. To add a service, see the [plugin authoring guide](docs/authoring/plugins.md).

## The hub

This hub runs on Cloudflare, receives events from GitHub, and runs Claude Code:

```ts [factory.infra.ts]
const vault = new cloudflare.Vault("vault");
const router = new cloudflare.Router("router", { vault });

const gh = new github.Connection("gh", { org: "acme", router });
new github.CodeHost("github", { allow: [{ owner: "acme" }], connection: gh });
new github.OperatorAuth("operators", { users: ["alice"], connection: gh });

const claudeToken = new sources.Env("claude-oauth-token", {
  config: { key: "CLAUDE_CODE_OAUTH_TOKEN", track: "scrypt" },
});
const claudeAccount = new claude.Account("claude", {
  auth: vault.secret({ id: "claude-oauth-token", value: claudeToken.credentials.value }),
});
new cloudflare.Deployer("deployer", { router, vault, accounts: [claudeAccount] });
```

Each class here is a resource group. A group creates real resources, such as a Worker or a GitHub App, and contributes entries to shared configs. For example, `github.Connection` creates its GitHub App, stores the App's private key and client secret in the vault, registers its webhook channel on the router, and contributes to the router's config.

## An outpost

Continuing the example, this outpost starts a Claude agent when a collaborator mentions `@claude` in an issue comment:

```ts [.factory/infra.ts]
const gh = github.Connection.get("gh").channel({ id: "issues" });

const code = new github.Policy("code", {
  permissions: { contents: "write", pull_requests: "write" },
});
const dev = new Container("dev", {
  image: "./Dockerfile",
  runtimes: [claude.runtime],
  policies: [code],
});
const coder = new claude.Agent("coder", { model: "claude-opus-5-5" });

new Trigger("mention", {
  event: gh.issueComment({ mention: "@claude", from: github.collaborators() }),
  worktree: (event) => `issue-${event.issue.number}`, // <-- `event` is typed by the selector
  agent: coder,
  container: dev,
});
```

`Connection.get("gh")` refers to the hub's connection by name. Every group in an outpost writes to one config resource, and the hub's deployer evaluates and applies it per repository. See the [Quickstart](docs/core/quickstart.md) to deploy your first hub and outpost.
