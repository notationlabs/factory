# Declaring Outposts

Each repository defines its own outpost in `.factory/`:

```text
.factory/
├── infra.ts           # Channels, Containers, Policies, Agents, and Triggers
├── config.ts          # the hub's GitHub Apps, for the CLI
├── Dockerfile         # container image definition
└── prompts/
    └── system.md      # prompt files referenced by Agents
```

The deployer evaluates `infra.ts` in a sandbox that allows only `@notation/factory`, the plugins the infrastructure installs in containers (its connections', policies' and runtimes'), and files inside `.factory/`.

`infra.ts` declares the outpost's resources at the top level:

```ts [.factory/infra.ts]
import { Container, Trigger } from "@notation/factory";
import * as claude from "@notation/factory-claude";
import * as github from "@notation/factory-github";

// channels, containers, policies, agents and triggers
```

The deployer runs Notation on `infra.ts` for the repo it's deploying. Every channel, container, policy, agent and trigger in the file adds its entry to that repo's outpost config. The snippets below all go in `infra.ts`. `config.ts` is the CLI's, and the deployer doesn't read it: see [CLI](./cli.md#config-files).

Within `infra.ts`, a trigger is the whole dispatch rule: which event, from whom, to which agent, in which container, on which branch:

```text
Channel ("issues") ──► Trigger ("mention") ──► Agent ("coder")
  event + from          │
                        └──► Container ("dev"), branch `issue-42` ◄── Policy ("code"), Runtime (claude)
```

## Channels

Pick the conversations this repo listens on, from connections the infra declares:

```ts [.factory/infra.ts]
const gh = github.Connection.get("gh").channel({ id: "issues" });         // <-- this repo's issues
const ops = slack.Connection.get("slack").channel({ id: "ops", scope: "#ops" }); // <-- a Slack channel
```

A channel is a connection plus a scope. `id` names the channel in the outpost's config. A GitHub channel's `scope` defaults to the outpost's repo; a Slack channel's is required. A scope belongs to at most one repo. See [Connections & Channels](./connections.md).

## Containers & policies

Define the remote machine, the runtimes it installs, and the credentials it is allowed to use:

```ts [.factory/infra.ts]
const code = new github.Policy("code", {
  permissions: { contents: "write", pull_requests: "write" },
});

const dev = new Container("dev", {
  image: "./Dockerfile",
  runtimes: [claude.runtime],
  policies: [code],
});
```

`dev` is the remote container built from `.factory/Dockerfile` with Claude Code installed, and `code` lets it push branches and open PRs. See [Containers & Policies](./containers.md).

## Agents & triggers

Run an agent in a worktree when a trusted author mentions it:

```ts [.factory/infra.ts]
const coder = new claude.Agent("coder", {
  model: "claude-opus-5-5",
  systemPrompt: "./prompts/system.md",
});

new Trigger("mention", {
  event: gh.issueComment({ mention: "@claude", from: github.collaborators() }),
  worktree: (event) => `issue-${event.issue.number}`,
  agent: coder,
  container: dev,
});

new Trigger("slack", {
  event: ops.mention("@claude", { from: slack.group("eng") }),
  agent: coder,
  container: dev, // <-- no worktree: the agent starts on the default branch
});
```

See [Agents & Triggers](./agents-and-triggers.md) and [Worktrees & Sessions](./worktrees.md).

## Subscribing & deploys

Subscribe the repository to build and activate its outpost:

```sh
factory repo install   # grant the hub access to the repo and wait for the initial container build
factory repo status    # check build status
```

Before it builds anything, the deployer evaluates the config and checks it. It fails the deploy with the reason in `FACTORY_STATUS` if:

| Check | Fails when |
| --- | --- |
| **Runtimes** | A container lists a runtime twice (it throws when declared), or lists one no infra `Account` covers |
| **Policies** | The code host can't mint credentials limited to the repo, the policy's permissions, and a short lifetime |
| **Triggers** | A trigger's container doesn't list the runtime its agent needs, or a trigger sets `base` without `worktree` (both throw when declared) |
| **Scopes** | A channel's scope already belongs to another repo, or isn't granted to the connection |

Once subscribed, pushing changes to `.factory/` on the default branch automatically updates the outpost:

| Change in `.factory/` | What updates |
| --- | --- |
| Any file | Rebuilds each container's image, since `.factory/` is the image's build context |
| `Trigger`, `Agent`, `Policy`, or prompts | Also takes effect on the next run, before the build finishes |
