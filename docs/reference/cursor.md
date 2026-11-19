# `@notation/factory-cursor`

`@notation/factory-cursor` provides the Cursor Agent `Account` for `factory.infra.ts`, the `runtime` and `Agent` for `.factory/infra.ts`, and the `setup.sh` that installs `agent` in outpost images.

```bash
@pm.dev("@notation/factory-cursor")
```

## Account

Give the hub the credentials Cursor Agent runs on:

```ts [factory.infra.ts]
import * as cursor from "@notation/factory-cursor";
import * as cloudflare from "@notation/factory-cloudflare";
import { sources } from "@notation/std/resources";

const vault = new cloudflare.Vault("vault");
const router = new cloudflare.Router("router", { vault });

const cursorKey = new sources.Env("cursor-api-key", {
  config: { key: "CURSOR_API_KEY", track: "scrypt" },
});
const cursorAccount = new cursor.Account("cursor", {
  auth: vault.secret({ id: "cursor-api-key", value: cursorKey.credentials.value }), // <-- from the Cursor dashboard
});

new cloudflare.Deployer("deployer", { router, vault, accounts: [cursorAccount] });
```

`auth` is a secret that you declare in the hub's vault with `vault.secret(...)`. You choose its id. Its value is a credential. Here, the `sources.Env` source reads `CURSOR_API_KEY` from your environment, and with `track: "scrypt"` `factory infra up` writes it to the vault only when it changes. Any other source works the same way, such as `sources.Dotenv` or `InfisicalSecret`. See [Secrets](../manual/secrets.md#credentials). Generate the key on the [Cursor dashboard](https://cursor.com/dashboard), under API Keys.

The account's `secrets` holds the key under the env var name `CURSOR_API_KEY`. Only the deployer binds it, under that name. The deployer injects it into every container that lists `cursor.runtime`, and no other.

## Runtime

Give a container Cursor Agent's credentials:

```ts [.factory/infra.ts]
import { Container } from "@notation/factory";
import * as cursor from "@notation/factory-cursor";

const dev = new Container("dev", {
  runtimes: [cursor.runtime], // <-- id "cursor"
});
```

The image must have `agent`. This package ships the `setup.sh` that installs it, which the deployer adds to every container that lists `cursor.runtime` (see [Containers](../manual/containers.md#image)). It also ships the runner module that tells the runner how to run `agent`. The runner fails a run if the image has no `agent`. A container that lists `cursor.runtime` fails its deploy unless the infra's deployer has a `cursor.Account` in its `accounts`.

## Agent

Configure a Cursor Agent for an outpost:

```ts [.factory/infra.ts]
const coder = new cursor.Agent("coder", {
  model: "composer-2.5",
  systemPrompt: "./prompts/coder.md", // <-- relative to .factory/
  settings: { approvalMode: "unrestricted" },
  files: {
    "~/.cursor/cli-config.json": "./cli-config.json",
  },
});
```

A trigger that runs `coder` must target a container that lists `cursor.runtime`.

| Option | Effect in outpost container |
| --- | --- |
| `model` | Passed as `--model`. A parameterized model takes its parameters in brackets, such as `claude-opus-4-8[effort=high]` |
| `mode` | `plan` or `ask`, passed as `--mode`. Without it, the CLI edits and runs commands |
| `systemPrompt` | Appended to the runner's prompt. The CLI has no flag for a system prompt, so both are placed before the conversation's messages |
| `settings` | Merged into `~/.cursor/cli-config.json` before the run |
| `files` | `~/.cursor/*` writes to `/data/agents/<name>/`; other `~/*` writes to `/data/home/`. Each value is a file in `.factory/` |

## Runtime invocation

A channel trigger runs the agent headless in the conversation's worktree:

`agent -p --output-format stream-json --force --trust --sandbox disabled --disable-auto-update <prompt> [--model <model>] [--mode plan\|ask] [--resume <uuid>]`

`<prompt>` is the runner's system prompt, then the agent's `systemPrompt`, then the conversation's messages. `--force` allows commands unless one is denied, `--trust` skips the workspace trust prompt, and `--sandbox disabled` lets those commands run. Without a `--resume`, the run starts a new session; with one, it continues the conversation's session. The runner saves the session's transcripts from `~/.cursor/chats` to the state store after each run, so a container that slept resumes the session.

In a headless run, the runner reads each of the agent's messages from the `stream-json` output and posts it to the conversation, in place of the last one. A subagent's messages are part of the task tool's result, so they aren't posted. The `result` event's text is the final reply, which replaces them. A failed run writes its error to stderr and exits non-zero, with no `result` event.
