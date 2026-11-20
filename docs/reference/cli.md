# `@notation/factory-cli`

The `factory` binary manages Notation Factory hubs from a hub repository and connects subscriber repositories to a hub. Only `infra` and `repo` subcommands are implemented today.

## Installation

```bash [Terminal]
@pm.add("-g @notation/factory-cli")
```

Hub lifecycle commands (`infra up` and `infra down`) require Bun to invoke `bun x --bun notation`.

Repository commands (`repo install` and `repo status`) require GitHub CLI (`gh`) and git.

## `factory infra`

Run `factory infra` commands from the directory containing `factory.infra.ts`.

### `factory infra up`

Deploys the hub by invoking `bun x --bun notation deploy --pretty` with optional `--credential` pass-through flags and any `loadEnv` wrapper from `factory.config.ts`:

```bash [Terminal]
factory infra up [--dry-run] [--credential <id>.<credential>@<hash>=<var>]
```

| Flag | Behavior |
| :--- | :--- |
| `--dry-run` | Runs `notation plan` instead of `notation deploy` |
| `--credential <spec>` | Repeatable credential override passed verbatim to `notation` |

### `factory infra status`

Calls `GET /admin/repos` and `GET /admin/deliveries` against `router` in `factory.config.ts`, printing each repository's latest deploy status, each container's latest image build, and failed deliveries from the last 7 days.

### `factory infra replay`

Retries failed deliveries via `POST /admin/replay` against `router` in `factory.config.ts`:

```bash [Terminal]
factory infra replay [<connection>/<id>]
```

Omitting the argument replays every currently failed delivery. When naming a specific `<delivery>` that is no longer marked failed, the command exits with status `1`.

### `factory infra down`

Destroys all deployed hub resources by invoking `bun x --bun notation destroy --pretty`.

## `factory repo`

Run `factory repo` commands inside an outpost repository directory containing `.factory/infra.ts`, or anywhere inside its git working tree.

### `factory repo install`

Guides GitHub App installation for every `github/ConnectionRef` referenced in `.factory/infra.ts` and waits up to 2 minutes for `FACTORY_STATUS` to update:

```bash [Terminal]
factory repo install [--repo <owner/name>]
```

### `factory repo status`

Reads `gh variable get FACTORY_STATUS --repo <repo>` and prints the latest deploy status, exiting with status `1` if `state` is `"failed"`.

## Config files and sessions

| File | Schema |
| :--- | :--- |
| `factory.config.ts` | `{ router?: string; loadEnv?: string }` |
| `.factory/config.ts` | `{ repo?: string; githubApps?: Record<string, number> }` |

Hub admin commands cache signed operator sessions (4-hour lifetime, refreshed automatically within 5 minutes of expiry via `http://127.0.0.1:47219/callback`) in `~/.config/notation-factory/sessions.json` with mode `0600`.
