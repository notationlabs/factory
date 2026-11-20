# `@notation/factory-claude`

Runs Anthropic Claude Code agents inside Notation Factory containers.

## Exports

| Export | Purpose |
| :--- | :--- |
| `Account` | Hub class binding a vault secret as `CLAUDE_CODE_OAUTH_TOKEN` |
| `Agent` | Outpost class configuring a Claude agent using `claude.runtime` |
| `runtime` | Runtime object installing Claude Code in images and executing `claude -p` |

## `Account`

```ts [factory.infra.ts]
const claudeAccount = new claude.Account("claude", {
  auth: vault.secret({
    id: "claude-oauth-token",
    value: claudeToken.credentials.value,
  }),
});
```

Takes `{ auth: VaultSecret }` and exposes `{ CLAUDE_CODE_OAUTH_TOKEN: auth }` to containers listed under `deployer.accounts`.

## `Agent`

```ts [.factory/infra.ts]
const coder = new claude.Agent("coder", {
  model: "claude-opus-5-5",
  effort: "high",
  systemPrompt: "./prompts/coder.md",
  settings: { cleanupPeriodDays: 30 },
  files: { "~/.claude/CLAUDE.md": "./CLAUDE.md" },
});
```

| Option | Details |
| :--- | :--- |
| `model` | Required model string passed to `--model` |
| `effort` | Optional reasoning effort: `"low"`, `"medium"`, `"high"`, `"xhigh"`, or `"max"` |
| `systemPrompt` | Optional `.factory/`-relative file appended with `--append-system-prompt` |
| `settings` | Optional JSON object passed via `--settings` |
| `files` | Optional map of `~/...` destinations to `.factory/`-relative source files |

## Runtime behavior

| Setting | Value |
| :--- | :--- |
| Installer script | `https://claude.ai/install.sh` run as `root` |
| Binary path | `/usr/local/bin/claude` |
| Command flags | `-p --output-format stream-json --verbose --dangerously-skip-permissions` |
| Config directory | `CLAUDE_CONFIG_DIR` set to `/data/agents/<agent>/.claude` |
| Environment | `DISABLE_AUTOUPDATER=1` and `CLAUDE_ENV_FILE` exporting `CLAUDE_CODE_OAUTH_TOKEN` |
| Tracked home file | `.claude.json` inside `CLAUDE_CONFIG_DIR` |
| Session resume | `--resume <sessionId>` |
| Transcript persistence | `projects` directory across container sleeps |
