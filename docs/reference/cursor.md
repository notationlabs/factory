# `@notation/factory-cursor`

Runs Cursor Agent CLI inside Notation Factory containers.

## Exports

| Export | Purpose |
| :--- | :--- |
| `Account` | Hub class binding a vault secret as `CURSOR_API_KEY` |
| `Agent` | Outpost class configuring a Cursor agent using `cursor.runtime` |
| `runtime` | Runtime object installing Cursor Agent in images and executing `agent -p` |

## `Account`

```ts [factory.infra.ts]
const cursorAccount = new cursor.Account("cursor", {
  auth: vault.secret({
    id: "cursor-api-key",
    value: cursorKey.credentials.value,
  }),
});
```

Takes `{ auth: VaultSecret }` and exposes `{ CURSOR_API_KEY: auth }` to containers listed under `deployer.accounts`.

## `Agent`

```ts [.factory/infra.ts]
const coder = new cursor.Agent("cursor-coder", {
  model: "grok-4.7-medium-fast",
  mode: "plan",
  systemPrompt: "./prompts/reviewer.md",
  settings: { permissions: { deny: ["Shell(rm *)"] } },
  files: { "~/.cursor/rules": "./rules" },
});
```

| Option | Details |
| :--- | :--- |
| `model` | Required model string passed to `--model` |
| `mode` | Optional mode `"plan"` or `"ask"`; omit for default edit and command execution |
| `systemPrompt` | Optional `.factory/`-relative file prepended to `stdin` before thread messages |
| `settings` | Optional object merged into `/data/agents/<agent>/.cursor/cli-config.json` |
| `files` | Optional map of `~/...` destinations to `.factory/`-relative source files |

## Runtime behavior

| Setting | Value |
| :--- | :--- |
| Installer script | `https://cursor.com/install` run as `root` |
| Install directory | `/opt/cursor-agent` linked to `/usr/local/bin/agent` |
| Command flags | `-p --output-format stream-json --force --trust --sandbox disabled --disable-auto-update` |
| Config directory | `CURSOR_CONFIG_DIR` set to `/data/agents/<agent>/.cursor` |
| Session resume | `--resume <sessionId>` |
| Transcript persistence | `chats` directory across container sleeps |
