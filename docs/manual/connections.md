# Connections & Channels

Connect the hub to a platform once, then let each repository pick the conversations it listens to:

```ts [factory.infra.ts]
export default factory(() => {
  // …
  const gh = new github.Connection("gh", { name: "acme-agents", org: "acme", router });
  new github.CodeHost("github", { connection: gh, allow: [{ owner: "acme" }] });

  new slack.Connection("slack", { name: "acme-agents", workspace: "acme", router });
});
```

```ts [.factory/config.ts]
export default outpost(() => {
  const gh = github.Connection.get("acme-agents").channel({ id: "issues" });         // <-- this repo's issues
  const ops = slack.Connection.get("acme-agents").channel({ id: "ops", scope: "#ops" }); // <-- one Slack channel
});
```

## The model

| Concept | Declared in | What it is |
| --- | --- | --- |
| **Connection** | `factory.infra.ts` | Notation Factory's presence on a platform: its credentials, bot identity and event feed. Declared once and shared by every repo. Only the router holds its credentials |
| **Grant** | On the platform | The reach a resource owner gives a connection, e.g. installing the GitHub App on a repo or inviting the Slack bot to a channel. It appears in neither config file |
| **Channel** | `.factory/config.ts` | A connection plus a scope, such as this repo's issues or a Slack channel. A repo picks the channels its triggers listen on. Its `id` names it in the outpost |
| **CodeHost** | `factory.infra.ts` | Where repos live. It decides which repos Notation Factory serves (`allow`) and mints the credentials containers use to call it directly |
| **Account** | `factory.infra.ts` | Credentials for an agent runtime, which the deployer injects into containers |
| **Runtime** | `.factory/config.ts` | What a container's image installs so it can run a kind of agent |
| **Container** | `.factory/config.ts` | A repo's machine, with the runtimes and policies it has |
| **Worktree** | `.factory/config.ts` | A container's working directory on the branch a trigger's `worktree` function names from the event |
| **Trigger** | `.factory/config.ts` | The complete dispatch rule: this event, from these authors, to this agent, in this container, optionally on a branch |

On GitHub, one App is both the connection and the code host's token issuer, so these concepts look like one thing. On Slack, the connection is only a channel: code still lives on the code host.

## Scopes and grants

A channel's scope belongs to at most one repo. If two repos listen on `#ops`, the second one's deploy fails with `#ops already belongs to acme/webapp`.

The deployer checks the grant for every scope a repo's triggers use:

| Platform | Scope | Grant | Event feed |
| --- | --- | --- | --- |
| GitHub | A repo (`scope` defaults to the outpost's repo) | Install the App on the repo (`factory repo install`) | The App's webhook |
| Slack | A Slack channel | Invite the bot to the channel (`/invite @acme-agents`) | Slack's Events API |

A scope that isn't granted fails the deploy with `#ops isn't granted`, and `FACTORY_STATUS` says what to do. Once granted, the deployer has the connection start listening, which is idempotent: it adds a webhook, joins a channel, or does nothing.

## Trust

Every event selector takes a required `from`. Nothing is trusted by default:

```ts [.factory/config.ts]
gh.issueComment({ mention: "@claude", from: github.collaborators() })
gh.issueComment({ mention: "@claude", from: github.team("acme/core") })
ops.mention("@claude", { from: slack.group("eng") })
ops.mention("@claude", { from: [slack.group("eng"), slack.user("dan@acme.dev")] })
```

- `from` decides who can start a run. The router checks it when it matches the event.
- Every message in the conversation reaches the agent. Each one is marked trusted if its author matches the trigger's `from`, and untrusted otherwise. Nothing is filtered out.

## Channel relay

Containers hold no channel credential. Many platforms' tokens cover a whole workspace and can't be narrowed, so the router acts on the container's behalf:

```text
Container ("dev" in acme/webapp)
  │  reply(conversation, markdown), signed with FACTORY_CONTAINER_KEY
  ▼
Router
  │  1. checks it dispatched this conversation to this container
  │  2. calls the channel with the connection's credentials
  ▼
Slack thread / GitHub issue
```

The relay lets a container read a conversation's thread and messages, reply to it, and acknowledge an event. The router refuses any call for a conversation it didn't dispatch to that container.

Code is different: containers call the code host directly, with credentials limited to one repo and the policy's permissions, and short-lived. See [Containers & Policies](./containers.md#policies).
