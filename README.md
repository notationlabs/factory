# Notation Factory

Notation Factory runs coding agents in remote containers. It starts an agent when an event arrives on a channel your team uses, such as an issue tracker or a chat app. You can also connect to a running agent over SSH.

You declare the infrastructure in TypeScript and deploy it with [Notation](https://github.com/notationlabs/notation).

## Hub and outposts

An organisation has one hub and one outpost per repo.

| | Hub | Outpost |
| --- | --- | --- |
| Declared in | `factory.infra.ts` | `.factory/config.ts` in each repo |
| Contains | A router, a deployer, a vault, connections and agent accounts | Channels, containers, policies, agents and triggers |
| Deployed by | Notation | The hub's deployer |

The router receives events from each connection. The deployer provisions containers. The vault holds secrets.

## Plugins

`@notation/factory` defines contracts for each part of a hub and an outpost. Plugins implement the contracts for a particular service:

| Contract | What the plugin provides | Plugins today (`@notation/…`) |
| --- | --- | --- |
| Vault, Router, Deployer | Where the hub and containers run | `factory-cloudflare`, `factory-railway` |
| Connection, Channel | Where events come from, and which events a trigger can select | `factory-github`, `factory-slack` |
| CodeHost, Policy | Where code lives, and what a container may do there | `factory-github` |
| OperatorAuth | Who may operate the agents | `factory-github`, `factory-cloudflare` |
| Account, Agent, runtime | Which coding agent runs | `factory-claude` |

An outpost's `.factory/config.ts` does not name the hosting provider, so the hub can move from one provider to another without changes to each repo. To add a service, write a plugin that implements its contract (see `docs/manual/plugins.md`).

## The hub

For example, this hub runs on Cloudflare, receives events from GitHub, and runs Claude:

```ts
export default factory(() => {
  const vault = new cloudflare.Vault("vault");
  const router = new cloudflare.Router("router", { project: "acme-agents", vault });

  const gh = new github.Connection("gh", { name: "acme-agents", org: "acme", router });
  new github.CodeHost("github", { allow: [{ owner: "acme" }], connection: gh });
  new github.OperatorAuth("operators", { logins: ["alice"], connection: gh });

  const claudeAccount = new claude.Account("claude", {
    auth: secret.env("CLAUDE_CODE_OAUTH_TOKEN"),
  });
  new cloudflare.Deployer("deployer", { router, vault, accounts: [claudeAccount] });
});
```

Each class here is a group. A group creates real resources, such as a Worker or a GitHub App, and adds entries to shared ones. For example, `github.Connection` adds its App to the router's config and its private key to the vault.

## An outpost

Continuing the example, this outpost starts a Claude agent when a collaborator mentions `@claude` in an issue comment:

```ts
export default outpost(() => {
  const gh = github.Connection.get("acme-agents").channel({ id: "issues" });

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
});
```

`Connection.get("acme-agents")` refers to the connection that the hub declares, by name. Every group in an outpost writes to one resource, the outpost's config. The deployer applies that config to the repo.
