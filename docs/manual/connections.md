# Connections & Channels

Connect the hub to a platform once, then let each repository pick the conversations it listens to:

```ts [factory.infra.ts]
// …
const gh = new github.Connection("gh", { org: "acme", router });
new github.CodeHost("github", { connection: gh, allow: [{ owner: "acme" }] });

new slack.Connection("slack", { workspace: "acme", router });
```

```ts [.factory/infra.ts]
const gh = github.Connection.get("gh").channel({ id: "issues" });         // <-- this repo's issues
const ops = slack.Connection.get("slack").channel({ id: "ops", scope: "#ops" }); // <-- one Slack channel
```

## The model

| Concept | Declared in | What it is |
| --- | --- | --- |
| **Connection** | `factory.infra.ts` | Notation Factory's presence on a platform: its credentials, bot identity and event feed. Declared once and shared by every repo. Only the router holds its credentials |
| **Grant** | On the platform | The reach a resource owner gives a connection, e.g. installing the GitHub App on a repo or inviting the Slack bot to a channel. It appears in neither config file |
| **Channel** | `.factory/infra.ts` | A connection plus a scope, such as this repo's issues or a Slack channel. A repo picks the channels its triggers listen on. Its `id` names it in the outpost |
| **CodeHost** | `factory.infra.ts` | Where repos live. It decides which repos Notation Factory serves (`allow`) and mints the credentials containers use to call it directly |
| **Account** | `factory.infra.ts` | Credentials for an agent runtime, which the deployer injects into containers |
| **Runtime** | `.factory/infra.ts` | A kind of agent, such as `claude`. It matches a container to an `Account`, and names the CLI that the container's image must have |
| **Container** | `.factory/infra.ts` | A repo's machine, with the runtimes and policies it has |
| **Worktree** | `.factory/infra.ts` | A container's working directory on the branch a trigger's `worktree` function names from the event |
| **Trigger** | `.factory/infra.ts` | The complete dispatch rule: this event, from these authors, to this agent, in this container, optionally on a branch |

On GitHub, one App is both the connection and the code host's token issuer, so these concepts look like one thing. On Slack, the connection is only a channel: code still lives on the code host.

## Scopes and grants

A channel's scope belongs to at most one repo. If two repos listen on `#ops`, the second one's deploy fails with `#ops already belongs to acme/webapp`.

The deployer checks the grant for every scope a repo's triggers use:

| Platform | Scope | Grant | Event feed |
| --- | --- | --- | --- |
| GitHub | A repo (`scope` defaults to the outpost's repo) | Install the App on the repo (`factory repo install`) | The App's webhook |
| Slack | A Slack channel | Invite the bot to the channel (`/invite @<app>`) | Slack's Events API |

A scope that isn't granted fails the deploy with `#ops isn't granted`, and `FACTORY_STATUS` says what to do. Once granted, the deployer has the connection start listening, which is idempotent: it adds a webhook, joins a channel, or does nothing.

## Trust

Every event selector takes a required `from`. Nothing is trusted by default:

```ts [.factory/infra.ts]
gh.issueComment({ mention: "@claude", from: github.collaborators() })
gh.issueComment({ mention: "@claude", from: github.team("acme/core") })
ops.mention("@claude", { from: slack.group("eng") })
ops.mention("@claude", { from: [slack.group("eng"), slack.user("dan@acme.dev")] })
```

- `from` decides who can start a run. The router checks it when it matches the event.
- A run's prompt has the conversation's messages that the agent's session hasn't seen, in the thread's order. The message that started the run has `trigger="true"`. Each message shows its author's role and whether they match the trigger's `from`, as `can_trigger_agent`. A reply from one of the hub's agents shows the agent's name instead, and another bot shows only its login. Nothing is filtered out. The runner's system prompt tells the agent to act on messages from authors who match, and to read the others as context.

On GitHub, a run's prompt looks like this:

```text
### Messages in thread since last turn

<message user="@notation-factory-hub[bot]" agent="claude-coder">
The handler compares `expires` in seconds against `Date.now()` in milliseconds. …
</message>

<message user="@dependabot[bot]">
Bumps jsonwebtoken from 9.0.0 to 9.0.2.
</message>

<message user="@alice" role="triage" can_trigger_agent="false">
@claude can you also bump the token lifetime to 30 days?
</message>

<message user="@dan" role="admin" can_trigger_agent="true" trigger="true">
@claude fix both and open a PR.
</message>

<message user="@alice" role="triage" can_trigger_agent="false">
Thanks!
</message>
```

A body can't open or close a `<message>` tag: the runner escapes `<message` and `</message` in it as `&lt;message` and `&lt;/message`.

The runner builds the prompt when the run starts, not when the router dispatches it, since a run may wait in the container's queue behind others:

1. It asks the router for the thread's messages, with the run's reply ticket.
2. It leaves out the messages that the agent's session has seen, and the agent's own replies. After each run, the runner saves a hash of each message's body with the session, so a message that someone edited since shows again, in full, with `edited="true"`.
3. If nothing is left, the run is skipped, and nothing is posted. This happens when an earlier run in the queue already showed the agent the messages. A run that an event without a message started, such as a label being added, is never skipped.
4. A new session, or one that was lost, gets the whole thread, under `### Messages in thread`.

A run that such an event started has no message with `trigger="true"`. Its prompt starts with what happened, which the channel describes, and then has any messages the agent hasn't seen. The agent resumes its session:

```text
### Event

The issue was labelled `ready`.

### Messages in thread since last turn

<message user="@alice" role="triage" can_trigger_agent="false">
This one is ready to pick up.
</message>
```

The role is the author's role on the repo, which the router asks GitHub for. Each reply starts with a hidden marker, `<!-- factory:agent=<id> -->`, which names the agent. The router reads the marker only in the App's own comments.

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

The relay lets a container read a conversation's messages and reply to it. The router refuses any call for a conversation it didn't dispatch to that container: each run gets a ticket that the router signed, which names the thread, and the router reads and replies only on that thread.

A reply can replace a message that an earlier reply of the same run posted. The router answers each reply with the message's id, signed together with the run's reply ticket, and replaces a message only when the container sends that signature back. A run can't edit any other message.

Code is different: containers call the code host directly, with credentials limited to one repo and the policy's permissions, and short-lived. See [Containers & Policies](./containers.md#policies).
