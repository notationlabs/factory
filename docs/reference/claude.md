# `@notation/factory-claude`

`@notation/factory-claude` provides the Claude Code `Account` for `factory.infra.ts`, the `runtime` and `Agent` for `.factory/config.ts`, and the adapter that executes `claude` inside outpost containers.

```bash
@pm.dev("@notation/factory-claude")
```

## Account

Give the hub the credentials Claude Code runs on:

```ts [factory.infra.ts]
import * as claude from "@notation/factory-claude";
import * as cloudflare from "@notation/factory-cloudflare";
import { env } from "@notation/std/sources";

const vault = new cloudflare.Vault("vault");
const router = new cloudflare.Router("router", {
  project: "acme-agents",
  vault,
});

const claudeAccount = new claude.Account("claude", {
  auth: vault.secret({ id: "claude-oauth-token", source: env, key: "CLAUDE_CODE_OAUTH_TOKEN" }), // <-- from `claude setup-token`
});

new cloudflare.Deployer("deployer", { router, vault, accounts: [claudeAccount] });
```

`auth` is a secret that you declare in the hub's vault with `vault.secret(...)`. You choose its id. Here, `factory infra up` reads `CLAUDE_CODE_OAUTH_TOKEN` from your environment and writes it to the vault on every deploy. Without a source, `vault.secret({ id: "claude-oauth-token" })` makes `factory infra up` ask for the token, and `notation secret set claude-oauth-token` sets it. See [Secrets](../manual/secrets.md#where-a-value-comes-from).

The account's `secrets` holds the token under the env var name `CLAUDE_CODE_OAUTH_TOKEN`. Only the deployer binds it, under that name. The deployer injects it into every container that lists `claude.runtime`, and no other.

## Runtime

Install Claude Code in a container's image:

```ts [.factory/config.ts]
import { Container } from "@notation/factory";
import * as claude from "@notation/factory-claude";

const dev = new Container("dev", {
  image: "./Dockerfile",
  runtimes: [claude.runtime], // <-- id "claude"; its setup.sh runs at image build
});
```

The runtime's setup runs through the Dockerfile's `runtime` mount (see [Runtimes](../manual/containers.md#runtimes)). A container that lists `claude.runtime` fails its deploy unless the infra's deployer has a `claude.Account` in its `accounts`.

## Agent

Configure a Claude Code agent for an outpost:

```ts [.factory/config.ts]
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
| `model` | Written to `/data/agents/<name>/settings.json` (and passed via `--model`) |
| `effort` | Passed as `--effort <low \| medium \| high \| xhigh \| max>` |
| `systemPrompt` | Appended to runner prompt at `/data/agents/<name>/system-prompt.md` |
| `settings` | Merged into `/data/agents/<name>/settings.json` at runtime |
| `files` | `~/.claude/*` writes to `/data/agents/<name>/`; other `~/*` writes to `/data/home/`. Each value is a file in `.factory/` |

## Runtime invocation

Each agent runs with `CLAUDE_CONFIG_DIR=/data/agents/<name>`:

| Mode | Invocation |
| --- | --- |
| **Channel trigger (headless)** | `claude -p --output-format=stream-json --dangerously-skip-permissions --session-id=<uuid>` (or `--resume=<uuid>`) |
| **`factory container resume` (TUI)** | `claude --append-system-prompt-file=... --resume=<uuid>` inside the conversation's worktree |
