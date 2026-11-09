# Worktrees & Sessions

Give each issue its own persistent branch so agents never overwrite each other's work:

```ts [.factory/config.ts]
new Trigger("mention", {
  event: gh.issueComment({ mention: "@claude", from: github.collaborators() }),
  worktree: (event) => `issue-${event.issue.number}`, // <-- issue #42 checks out branch `issue-42`
  agent: coder,
  container: dev,
});
```

The trigger's `worktree` function names the branch from the event. Each branch gets one persistent git worktree inside `dev`:

```text
Issue #42 ──► /data/worktrees/issue-42  (branch `issue-42`)
Issue #43 ──► /data/worktrees/issue-43  (branch `issue-43`)
```

TypeScript infers the event's type from `event`, so the function's parameter is typed: `event.issue.number` is checked against `gh.issueComment`'s events.

## Branches and bases

`base` is where a branch that doesn't exist yet is cut from. It defaults to the repo's default branch. A trigger that sets `base` without `worktree` throws:

```ts [.factory/config.ts]
new Trigger("docs", {
  event: gh.issueComment({ mention: "@claude", labels: ["docs"], from: github.team("acme/docs") }),
  worktree: (event) => `docs/${event.issue.number}`,
  base: "docs",
  agent: coder,
  container: dev,
});
```

The worktree function:

- returns the same branch for the same event, because worktrees and sessions are keyed by it. It doesn't read the clock or the network.
- returns `undefined` for no branch, which gives the same result as leaving `worktree` out.
- runs only in the container's runner, which imports `.factory/` at the event's commit and calls it with the real event. The function isn't data, so it isn't in the outpost's config: the config records only that the trigger has a worktree, and its `base`. The router only matches `event` and never runs the function, so the deployer can't check branch names ahead of time.

## No branch

Leave `worktree` out when the agent should work out what to do from the message:

```ts [.factory/config.ts]
new Trigger("slack", {
  event: ops.mention("@claude", { from: slack.group("eng") }),
  agent: coder,
  container: dev,
});
```

| `worktree:` | Working directory | Keyed by |
| --- | --- | --- |
| A function | One worktree on the branch it returns, kept between runs | `(container, branch)`. Conversations on the same branch share it |
| Left out, or the function returns `undefined` | A scratch worktree with a detached HEAD at the default branch, kept between runs. The agent can create or switch branches | `(container, conversation)` |

Git won't check out one branch in two worktrees, so branch worktrees are keyed by branch.

## Sessions

An agent session is keyed by `(container, conversation)` in both cases, and replies go to the conversation. Each agent keeps its own session in the conversation. Follow-up triggers in the same conversation resume it, and `factory container resume` looks sessions up by conversation.

## Multiple containers

Run separate environments in parallel on the same issue by pointing triggers at different containers:

```ts [.factory/config.ts]
new Trigger("linux", {
  event: gh.issueComment({ mention: "@claude", from: github.collaborators() }),
  worktree: (event) => `linux-${event.issue.number}`,
  agent: coder,
  container: linux,
});

new Trigger("sec", {
  event: gh.issueComment({ mention: "@auditor", from: github.team("acme/security") }),
  worktree: (event) => `sec-${event.issue.number}`,
  agent: auditor,
  container: sec,
});
```

Each container has its own `/data`, so `linux` and `sec` run independently.

## Concurrency

Each branch worktree runs one agent at a time, and queues the rest:

| Event on issue `#42` | What happens |
| --- | --- |
| **1. Trigger arrives (idle)** | Starts the agent in the `issue-42` worktree |
| **2. Trigger arrives (busy)** | Queues the run behind the current one |
| **3. Queued run starts** | Sees every message posted in the conversation since the last run |
