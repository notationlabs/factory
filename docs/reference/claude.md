# `@notation/factory-claude`

`@notation/factory-claude` provides the Claude Code `Account` for `factory.infra.ts`, the `runtime` and `Agent` for `.factory/infra.ts`, and the `setup.sh` that installs `claude` in outpost images.

```bash
@pm.dev("@notation/factory-claude")
```

## Account

Give the hub the credentials Claude Code runs on:

```ts [factory.infra.ts]
import * as claude from "@notation/factory-claude";
import * as cloudflare from "@notation/factory-cloudflare";
import { sources } from "@notation/std/resources";

const vault = new cloudflare.Vault("vault");
const router = new cloudflare.Router("router", { vault });

const claudeToken = new sources.Env("claude-oauth-token", {
  config: { key: "CLAUDE_CODE_OAUTH_TOKEN", track: "scrypt" },
});
const claudeAccount = new claude.Account("claude", {
  auth: vault.secret({ id: "claude-oauth-token", value: claudeToken.credentials.value }), // <-- from `claude setup-token`
});

new cloudflare.Deployer("deployer", { router, vault, accounts: [claudeAccount] });
```

`auth` is a secret that you declare in the hub's vault with `vault.secret(...)`. You choose its id. Its value is a credential. Here, the `sources.Env` source reads `CLAUDE_CODE_OAUTH_TOKEN` from your environment, and with `track: "scrypt"` `factory infra up` writes it to the vault only when it changes. Any other source works the same way, such as `sources.Dotenv` or `InfisicalSecret`. See [Secrets](../manual/secrets.md#credentials).

The account's `secrets` holds the token under the env var name `CLAUDE_CODE_OAUTH_TOKEN`. Only the deployer binds it, under that name. The deployer injects it into every container that lists `claude.runtime`, and no other.

## Runtime

Give a container Claude Code's credentials:

```ts [.factory/infra.ts]
import { Container } from "@notation/factory";
import * as claude from "@notation/factory-claude";

const dev = new Container("dev", {
  runtimes: [claude.runtime], // <-- id "claude"
});
```

The image must have `claude`. This package ships the `setup.sh` that installs it, which the deployer adds to every container that lists `claude.runtime` (see [Containers](../manual/containers.md#image)). It also ships the runner module that tells the runner how to run `claude`. The runner fails a run if the image has no `claude`. A container that lists `claude.runtime` fails its deploy unless the infra's deployer has a `claude.Account` in its `accounts`.

## Agent

Configure a Claude Code agent for an outpost:

```ts [.factory/infra.ts]
const coder = new claude.Agent("coder", {
  model: "claude-opus-5-5",
  effort: "high",
  systemPrompt: "./prompts/coder.md", // <-- relative to .factory/
  settings: { cleanupPeriodDays: 30 },
  files: {
    "~/.claude/CLAUDE.md": "./CLAUDE.md",
  },
});
```

A trigger that runs `coder` must target a container that lists `claude.runtime`.

| Option | Effect in outpost container |
| --- | --- |
| `model` | Passed via `--model` |
| `effort` | Passed as `--effort <low \| medium \| high \| xhigh \| max>` |
| `systemPrompt` | Appended to the runner's prompt, and passed with `--append-system-prompt` |
| `settings` | Passed via `--settings`, over the agent's `settings.json` |
| `files` | `~/.claude/*` writes to `/data/agents/<name>/.claude/`; other `~/*` writes to `/data/home/`. Each value is a file in `.factory/` |

The container's own `~/.claude/*` files are written to each Claude agent's directory too, before the agent's `files`, so an agent's file replaces the container's file at the same path.

## Runtime invocation

Each agent runs with `CLAUDE_CONFIG_DIR=/data/agents/<name>/.claude`, so agents in one container don't share settings, files or sessions. The runner saves the session's transcripts from the agent's `projects` directory to the state store after each run, so a container that slept resumes the session.

| Mode | Invocation |
| --- | --- |
| **Channel trigger (headless)** | `claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --session-id=<uuid>` (or `--resume=<uuid>`) |
| **`factory container resume` (TUI)** | `claude --append-system-prompt-file=... --resume=<uuid>` inside the conversation's worktree |

In a headless run, the runner reads each of the agent's messages from the `stream-json` output and posts it to the conversation, in place of the last one. A message with only thinking is posted as "Thinking...". Subagents' messages aren't posted. The `result` event's text is the final reply, which replaces them.
