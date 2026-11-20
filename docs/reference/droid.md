# `@notation/factory-droid`

Runs Factory Droid CLI inside Notation Factory containers.

## Exports

| Export | Purpose |
| :--- | :--- |
| `Account` | Hub class binding a vault secret as `FACTORY_API_KEY` |
| `Agent` | Outpost class configuring a Droid agent using `droid.runtime` |
| `runtime` | Runtime object installing Droid in images and executing `droid exec` |

## `Account`

```ts [factory.infra.ts]
const droidAccount = new droid.Account("droid", {
  auth: vault.secret({
    id: "factory-api-key",
    value: droidKey.credentials.value,
  }),
});
```

Takes `{ auth: VaultSecret }` and exposes `{ FACTORY_API_KEY: auth }` to containers listed under `deployer.accounts`.

## `Agent`

```ts [.factory/infra.ts]
const coder = new droid.Agent("droid-coder", {
  model: "claude-opus-5-5",
  effort: "medium",
  autonomy: "high",
  systemPrompt: "./prompts/droid.md",
  settings: { customKey: true },
  files: { "~/.factory/AGENTS.md": "./AGENTS.md" },
});
```

| Option | Details |
| :--- | :--- |
| `model` | Required model string passed to `--model` |
| `effort` | Optional reasoning effort passed as `--reasoning-effort`: `"none"`, `"low"`, `"medium"`, or `"high"` |
| `autonomy` | Optional level passed as `--auto`: `"low"`, `"medium"`, or `"high"` |
| `systemPrompt` | Optional `.factory/`-relative file appended via `--append-system-prompt` |
| `settings` | Optional JSON object passed via `--settings` alongside `/data/agents/<agent>/settings.json` |
| `files` | Optional map of `~/...` destinations to `.factory/`-relative source files |

When `autonomy` is omitted, Factory passes `--skip-permissions-unsafe` so unattended container runs execute without permission prompts.

## Runtime behavior

| Setting | Value |
| :--- | :--- |
| System packages | Ensures `procps` is installed before running the installer |
| Installer script | `https://app.factory.ai/cli` run as `root` |
| Binary path | `/usr/local/bin/droid` |
| Command flags | `exec --output-format stream-json` |
| Config directory | `FACTORY_HOME_OVERRIDE` set to `/data/agents/<agent>` |
| Agent settings | Enables `showThinkingInMainView` in `settings.json` |
| Session resume | `--session-id <sessionId>` |
| Transcript persistence | `sessions` directory across container sleeps |
