# `@notation/factory-droid`

`@notation/factory-droid` provides the Droid `Account` for `factory.infra.ts`, the `runtime` and `Agent` for `.factory/infra.ts`, and the `setup.sh` that installs `droid` in outpost images.

```bash
@pm.dev("@notation/factory-droid")
```

## Account

Give the hub the credentials Droid runs on:

```ts [factory.infra.ts]
import * as droid from "@notation/factory-droid";
import * as cloudflare from "@notation/factory-cloudflare";
import { sources } from "@notation/std/resources";

const vault = new cloudflare.Vault("vault");
const router = new cloudflare.Router("router", { vault });

const factoryKey = new sources.Env("factory-api-key", {
  config: { key: "FACTORY_API_KEY", track: "scrypt" },
});
const droidAccount = new droid.Account("droid", {
  auth: vault.secret({ id: "factory-api-key", value: factoryKey.credentials.value }), // <-- from the Factory settings page
});

new cloudflare.Deployer("deployer", { router, vault, accounts: [droidAccount] });
```

`auth` is a secret that you declare in the hub's vault with `vault.secret(...)`. You choose its id. Its value is a credential. Here, the `sources.Env` source reads `FACTORY_API_KEY` from your environment, and with `track: "scrypt"` `factory infra up` writes it to the vault only when it changes. Any other source works the same way, such as `sources.Dotenv` or `InfisicalSecret`. See [Secrets](../manual/secrets.md#credentials). Generate the key on the [Factory settings page](https://app.factory.ai/settings/api-keys).

The account's `secrets` holds the key under the env var name `FACTORY_API_KEY`. Only the deployer binds it, under that name. The deployer injects it into every container that lists `droid.runtime`, and no other.

## Runtime

Give a container Droid's credentials:

```ts [.factory/infra.ts]
import { Container } from "@notation/factory";
import * as droid from "@notation/factory-droid";

const dev = new Container("dev", {
  runtimes: [droid.runtime], // <-- id "droid"
});
```

The image must have `droid`. This package ships the `setup.sh` that installs it, along with `procps` when the image has no `ps`, which Droid's Execute supervisor needs. The deployer adds the setup to every container that lists `droid.runtime` (see [Containers](../manual/containers.md#image)). It also ships the runner module that tells the runner how to run `droid exec`. The runner fails a run if the image has no `droid`. A container that lists `droid.runtime` fails its deploy unless the infra's deployer has a `droid.Account` in its `accounts`.

## Agent

Configure a Droid agent for an outpost:

```ts [.factory/infra.ts]
const coder = new droid.Agent("coder", {
  model: "claude-opus-5-5",
  effort: "high",
  autonomy: "medium",
  systemPrompt: "./prompts/coder.md", // <-- relative to .factory/
  settings: { hooks: { hooksDisabled: true } },
  files: {
    "~/.factory/AGENTS.md": "./AGENTS.md",
  },
});
```

A trigger that runs `coder` must target a container that lists `droid.runtime`.

| Option | Effect in outpost container |
| --- | --- |
| `model` | Passed via `--model` |
| `effort` | Passed as `--reasoning-effort <none \| low \| medium \| high>` |
| `autonomy` | Passed as `--auto <low \| medium \| high>`; without it, runs pass `--skip-permissions-unsafe` |
| `systemPrompt` | Appended to the runner's prompt, and passed with `--append-system-prompt` |
| `settings` | Written to `/data/agents/<name>/settings.json`, and passed via `--settings` |
| `files` | `~/.factory/*` writes to `/data/agents/<name>/.factory/`; other `~/*` writes to `/data/home/`. Each value is a file in `.factory/` |

The container's own `~/.factory/*` files are written to each Droid agent's directory too, before the agent's `files`, so an agent's file replaces the container's file at the same path.

## Runtime invocation

A channel trigger runs the agent headless in the conversation's worktree, with `FACTORY_HOME_OVERRIDE=/data/agents/<name>`. Droid reads `.factory` under that directory in place of `~/.factory`, so agents in one container don't share settings, files or sessions. Droid doesn't document the variable:

`droid exec --output-format stream-json [--auto <level> \| --skip-permissions-unsafe] [--session-id <uuid>]`, with the prompt on stdin. A whole thread can be longer than one argument may be.

The runner reads each of the agent's messages from the `stream-json` output and posts it to the conversation, in place of the last one. Droid runs subagents in their own processes, so their messages aren't in the output and aren't posted. When the agent thinks, the runner posts "Thinking..." in place of its thoughts. To keep thinking out of the agent's messages, the runner sets `showThinkingInMainView` to `true` in the agent's `.factory/settings.json` before each run. Droid reads that setting when it creates a session, so a session created without it may still post its thinking. The `completion` event's `finalText` is the final reply, which replaces them. A failed run ends with an `error` event instead, whose message the runner posts as the error.

Without a `--session-id`, the run starts a new session; with one, it continues the conversation's session. The runner saves the session's transcripts from the agent's `.factory/sessions` to the state store after each run, so a container that slept resumes the session.
