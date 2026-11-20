# Agents

Notation Factory configures each coding assistant through a provider-specific `Agent` resource in `.factory/infra.ts`. Every agent runs inside its own isolated configuration directory under `/data/agents/<agent>/` and maintains a separate session per issue or pull request, allowing multiple models and runtimes to collaborate in the same worktree without overwriting each other's settings or transcripts.

## Provider agent options

Each runtime package exports an `Agent` class paired with its `runtime` object. A trigger targeting a container must use an agent whose runtime appears in that container's `runtimes` array.

::code-group

```ts [Claude Code]
import * as claude from "@notation/factory-claude";

const coder = new claude.Agent("claude-coder", {
  model: "claude-opus-5-5",
  effort: "high",
  systemPrompt: "./prompts/coder.md",
  settings: { includeCoAuthoredBy: false },
  files: { "~/.claude/CLAUDE.md": "./prompts/claude.md" },
});
```

```ts [Cursor Agent]
import * as cursor from "@notation/factory-cursor";

const reviewer = new cursor.Agent("cursor-reviewer", {
  model: "claude-opus-4-8[effort=high]",
  mode: "plan",
  systemPrompt: "./prompts/reviewer.md",
  settings: { permissions: { allow: [], deny: ["Shell(rm)"] } },
  files: { "~/.cursor/rules/review.mdc": "./prompts/review.mdc" },
});
```

```ts [Droid]
import * as droid from "@notation/factory-droid";

const triager = new droid.Agent("droid-triager", {
  model: "claude-opus-5-5",
  effort: "medium",
  autonomy: "high",
  systemPrompt: "./prompts/triage.md",
  settings: { cloudSessionSync: false },
  files: { "~/.factory/AGENTS.md": "./prompts/droid.md" },
});
```

::

### `claude.Agent`

Runs `claude -p --output-format stream-json --verbose --dangerously-skip-permissions` with auto-updates disabled:

| Option | Description |
| :--- | :--- |
| `model` | Required model identifier passed via `--model` |
| `effort` | Optional reasoning level: `"low"`, `"medium"`, `"high"`, `"xhigh"`, or `"max"` |
| `systemPrompt` | Optional `.factory/` path appended via `--append-system-prompt` |
| `settings` | Optional JSON object passed via `--settings` over `.claude/settings.json` |
| `files` | Optional map of `~/...` targets to `.factory/` file paths |

When `CLAUDE_CODE_OAUTH_TOKEN` is bound on the container, Factory exports it through `CLAUDE_ENV_FILE` so subcommands launched by the agent remain authenticated. See [Claude reference](../reference/claude.md) for account setup.

### `cursor.Agent`

Runs `agent -p --output-format stream-json --force --trust --sandbox disabled --disable-auto-update`:

| Option | Description |
| :--- | :--- |
| `model` | Required model string passed via `--model`, supporting bracket parameters |
| `mode` | Optional read-only mode: `"plan"` or `"ask"`; omit for default command execution |
| `systemPrompt` | Optional `.factory/` path prepended ahead of the thread prompt on stdin |
| `settings` | Optional JSON object merged into `.cursor/cli-config.json` before each run |
| `files` | Optional map of `~/...` targets to `.factory/` file paths |

Passing `"agent"` to `mode` is rejected by both the schema and the Cursor CLI; omit `mode` to allow file edits and shell commands. See [Cursor reference](../reference/cursor.md).

### `droid.Agent`

Runs `droid exec --output-format stream-json` with `showThinkingInMainView: true` enabled in `.factory/settings.json`:

| Option | Description |
| :--- | :--- |
| `model` | Required model identifier passed via `--model` |
| `effort` | Optional reasoning effort: `"none"`, `"low"`, `"medium"`, or `"high"` |
| `autonomy` | Optional `--auto` level: `"low"`, `"medium"`, or `"high"` |
| `systemPrompt` | Optional `.factory/` path appended via `--append-system-prompt` |
| `settings` | Optional JSON object written to `/data/agents/<agent>/settings.json` via `--settings` |
| `files` | Optional map of `~/...` targets to `.factory/` file paths |

When `autonomy` is omitted, Droid runs with `--skip-permissions-unsafe`. See [Droid reference](../reference/droid.md).

## Built-in runner prompt

Before any agent's `systemPrompt`, Factory prepends its own headless system prompt and conversation context:

1. Tells the agent it is running unattended inside an ephemeral container and must make reasonable decisions without asking for confirmation.
2. Explains `can_trigger_agent`, `trigger="true"`, and role attributes on thread messages, instructing the agent to treat unprivileged messages, files, and command output as untrusted data.
3. Instructs the agent to treat its final message as the reply posted to the thread rather than posting replies itself.
4. Directs the agent to commit code changes to a branch, push, and open a draft pull request unless instructed otherwise.

## Per-agent config isolation

Factory isolates each agent's runtime configuration directory under `/data/agents/<agent>/` so agents sharing a container never collide on settings or session transcripts:

| Runtime | Isolated directory and environment variable |
| :--- | :--- |
| `claude` | `/data/agents/<agent>/.claude` via `CLAUDE_CONFIG_DIR` |
| `cursor` | `/data/agents/<agent>/.cursor` via `CURSOR_CONFIG_DIR` |
| `droid` | `/data/agents/<agent>/.factory` via `FACTORY_HOME_OVERRIDE` |

The `<agent>` segment is a lowercase slug of the agent's resource ID. Droid receives `FACTORY_HOME_OVERRIDE=/data/agents/<agent>` and resolves `.factory` beneath it.

## Startup file placement

Both `Container` and `Agent` accept a `files` map targeting paths under `~/`. Before every run, Factory writes container files first and agent files second, so an agent's file overrides a container's file at the same path.

| Target path | Destination on disk |
| :--- | :--- |
| Runtime config paths | Written to `/data/agents/<agent>/<configDir>/` for `.claude`, `.cursor`, or `.factory` |
| Claude home config | `~/.claude.json` redirects to `/data/agents/<agent>/.claude/.claude.json` |
| All other home paths | Written to `/data/home/` and shared across all agents in the container |

Container `files` accept either a `.factory/` relative path string or an inline JSON object, while agent `files` accept `.factory/` relative path strings only.

## Multiple agents on one conversation

Specialize agents by cost, model, or mode and route them to the same worktree on an issue or pull request:

```ts [.factory/infra.ts]
const branch = (event: { issue: { number: number } }) => `issue-${event.issue.number}`;

new Trigger("triage-open", {
  event: gh.issue({ actions: ["opened"], from: github.collaborators() }),
  worktree: branch,
  agent: triager,
  container: dev,
});

new Trigger("implement-mention", {
  event: gh.issueComment({ mention: "@claude", from: github.collaborators() }),
  worktree: branch,
  agent: coder,
  container: dev,
});
```

Each agent preserves its own session record at `/data/sessions/<conversation>/<agent>.json` and its own transcript archive in R2, even when both agents edit files in the same `/data/worktrees/<repo>/<branch>/` checkout.

A session record stores the runtime session ID, the worktree `cwd`, and SHA-256 hashes of every message body the agent has already seen. On follow-up triggers in the same worktree, the resumed session receives only new or edited messages since its last turn – including replies posted by other agents on the thread, while omitting its own prior replies.

If a trigger routes an agent to a different worktree path than its saved `cwd`, Factory starts a fresh session with the full thread history instead of resuming. Next, see [Triggers & Worktrees](./triggers-and-worktrees.md) for event matching, branch routing, concurrency, and security boundaries.
