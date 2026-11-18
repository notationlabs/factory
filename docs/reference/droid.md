# `@notation/factory-droid`

`@notation/factory-droid` provides the Droid `Account` for `factory.infra.ts`, the `runtime` and `Agent` for `.factory/config.ts`, and the `setup.sh` that installs `droid` in outpost images.

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

```ts [.factory/config.ts]
import { Container } from "@notation/factory";
import * as droid from "@notation/factory-droid";

const dev = new Container("dev", {
  runtimes: [droid.runtime], // <-- id "droid"
});
```

The image must have `droid`. This package ships the `setup.sh` that installs it: a container with no `image` gets it automatically, and a repo's own Dockerfile runs it (see [Containers](../manual/containers.md#image)). The runner fails a run if the image has no `droid`. A container that lists `droid.runtime` fails its deploy unless the infra's deployer has a `droid.Account` in its `accounts`.

## Agent

Configure a Droid agent for an outpost:

```ts [.factory/config.ts]
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
| `systemPrompt` | Appended to the system prompt via `--append-system-prompt` |
| `settings` | Written to `/data/agents/<name>/settings.json`, and passed via `--settings` |
| `files` | `~/.factory/*` writes to `/data/agents/<name>/`; other `~/*` writes to `/data/home/`. Each value is a file in `.factory/` |

## Runtime invocation

A channel trigger runs the agent headless in the conversation's worktree:

`droid exec <prompt> --output-format json [--auto <level> \| --skip-permissions-unsafe] [--session-id <uuid>]`

Without a `--session-id`, the run starts a new session; with one, it continues the conversation's session. The runner saves the session's transcripts from `~/.factory/sessions` to the state store after each run, so a container that slept resumes the session.
