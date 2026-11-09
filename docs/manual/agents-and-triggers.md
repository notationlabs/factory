# Agents & Triggers

Configure an agent persona and choose which channel events wake it:

```ts [.factory/config.ts]
const coder = new claude.Agent("coder", {
  model: "claude-opus-5-5",
  effort: "high",
  systemPrompt: "./prompts/coder.md",
});

new Trigger("mention", {
  event: gh.issueComment({ mention: "@claude", from: github.collaborators() }),
  worktree: (event) => `issue-${event.issue.number}`,
  agent: coder,
  container: dev,
});
```

`Agent` configures an agent (model, effort, and system prompt) for a runtime, and `Trigger` runs that agent in a container, optionally on a branch, whenever a matching event arrives from an author in `from`. Follow-up triggers in the same conversation resume `coder`'s session.

| `Trigger` input | Required | Meaning |
| --- | --- | --- |
| `event` | Yes | A channel's selector, including its `from` |
| `agent` | Yes | The agent to run. Its runtime must be in the container's `runtimes` |
| `container` | Yes | The `Container` to run it in |
| `worktree` | No | A function that names the branch to run on from the event. See [Worktrees & Sessions](./worktrees.md) |
| `base` | No | Where `worktree`'s branch is cut from if it doesn't exist yet. Only valid with `worktree` |

## Event selectors

Each channel builds selectors in its platform's own vocabulary. The router matches them as data, without running any of the repo's code:

```ts [.factory/config.ts]
gh.issue({ actions: ["opened"], labels: ["bug"], from: github.collaborators() })
gh.issueComment({ actions: ["created", "edited"], mention: "@claude", from: github.team("acme/core") })
ops.mention("@claude", { from: slack.group("eng") })
```

| Selector | Default `actions` | Supported `actions` | Filters |
| --- | --- | --- | --- |
| `gh.issue(opts)` | `["opened"]` | `"opened"`, `"edited"`, `"reopened"`, `"labeled"` | `mention`, `labels`, `from` |
| `gh.issueComment(opts)` | `["created"]` | `"created"`, `"edited"` | `mention`, `labels`, `from` |
| `ops.mention(name, opts)` | | | `from` |

When `actions` includes `"edited"`, the trigger fires only if the edit newly added the `@mention`.

## Trust

`from` is required on every selector. It decides who can start a run:

| Author set | Matches |
| --- | --- |
| `github.collaborators()` | Users with write access to the repo |
| `github.team("acme/core")` | Members of a GitHub team |
| `github.user("alice")` | One GitHub user |
| `slack.group("eng")` | Members of a Slack user group |
| `slack.user("dan@acme.dev")` | One Slack user |

Pass an array to accept several. Every message in the conversation still reaches the agent, marked trusted if its author matches `from` and untrusted otherwise. See [Connections & Channels](./connections.md#trust).

## Multiple agents on one conversation

Specialize agents by cost and capability for different tasks:

```ts [.factory/config.ts]
const triage = new claude.Agent("triage", {
  model: "claude-haiku-5-5",
  systemPrompt: "./prompts/triage.md",
});

const coder = new claude.Agent("coder", {
  model: "claude-opus-5-5",
  systemPrompt: "./prompts/coder.md",
});
```

Bind each agent to its stage of the issue lifecycle. A function shared by several triggers types its parameter with the fields it reads, which both events have:

```ts [.factory/config.ts]
const branch = (event: { issue: { number: number } }) => `issue-${event.issue.number}`;

new Trigger("on-open", {
  event: gh.issue({ actions: ["opened"], from: github.collaborators() }), // <-- 1. triage investigates new issues
  worktree: branch,
  agent: triage,
  container: dev,
});

new Trigger("on-mention", {
  event: gh.issueComment({ mention: "@claude", from: github.collaborators() }), // <-- 2. coder implements on @claude
  worktree: branch,
  agent: coder,
  container: dev,
});
```

Both `triage` and `coder` run inside the same `issue-42` git worktree while keeping their own session transcripts:

| Path | Scope | Holds |
| --- | --- | --- |
| `/data/worktrees/<branch>` | Shared per branch | Git checkout where agents read and write repo files |
| `/data/agents/<agent>/` | Isolated per `Agent` | Agent settings, prompts, and session transcripts |
