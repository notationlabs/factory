# Conversations & Sessions

Every conversation on `/data` can be driven from two interfaces interchangeably:

| Interface | Entrypoint | Runs in |
| --- | --- | --- |
| **Channel conversation** | `@claude` comment on GitHub issue `#42`, or `@claude` in a Slack thread | The trigger's worktree, e.g. `/data/worktrees/issue-42` |
| **Terminal session** | `factory container resume 42` | Same worktree and agent transcript over SSH |

A conversation is whatever the channel replies to: a GitHub issue, or a Slack thread. The agent's final message is posted back to it through the router.

When a message starts a run, the router reacts to it with 👀 before it hands the run to the container. While the agent runs, the runner posts the agent's latest message as one reply, and edits that reply with each later message, at most once every 10 seconds. While the agent thinks, the reply shows "Thinking..." instead of its thoughts, and a message that repeats the one shown isn't posted again. The final message replaces it. Claude, Cursor and Droid agents post messages during a run.

## Slash commands

Slash commands immediately after an `@mention` control the conversation's session:

| Message in the conversation | Session action |
| --- | --- |
| `@claude fix the failing test` | Resumes the existing session (or starts one on first turn) |
| `@claude /new try a different approach` | Starts a fresh session in the existing worktree |
| `@claude /compact keep test failure details` | Compacts the session context window before continuing |

## Terminal sessions

Drop into a remote worktree or take over an agent session from your terminal:

```sh
factory container resume              # pick interactively from all conversations' sessions
factory container resume 42           # attach to issue #42's session
factory container resume 42 coder     # select the `coder` agent on issue #42
factory container ssh                 # open a plain shell in `/data`
```

## Access control

Notation Factory enforces two boundaries, on public repositories and shared workspaces alike:

| Boundary | Enforcement |
| --- | --- |
| **Who starts a run** | The router only fires a trigger when the author matches its `from` |
| **What the agent reads** | Every message in the conversation reaches the agent, each marked trusted (its author matches `from`) or untrusted. Containers hold no channel credential: they read conversations through the router's relay, and only the ones it dispatched to them |

> [!IMPORTANT]
> A `github.Policy` with `issues: "write"` or `pull_requests: "write"` gives `gh` inside the container a token that can read raw comments via `gh issue view`, outside the relay's trust marking. Grant only the permissions each container requires.

## Failure recovery

Worktree and session state on `/data` survive errors and restarts:

| Failure | Reported in the conversation | Recovery |
| --- | --- | --- |
| **Agent exits with error** | `⚠️ The run failed.` + last 40 lines of `stderr` | Mention `@claude <prompt>` to retry, or `@claude /new <prompt>` |
| **Container restarts mid-run** | Interrupted-run notice + session ID on boot | Mention `@claude <prompt>` or run `factory container resume 42` |
| **Container unreachable or still building** | `Booting container dev...` while the router retries for about 5 minutes, then the error and a notice that the event was kept | Run `factory infra status`, then `factory infra replay`. See [Deliveries](./connections.md#deliveries) |
