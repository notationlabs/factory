# Agent Runtimes

An agent runtime plugin integrates a coding agent CLI into Notation Factory across `Account`, `Agent`, and `runtime` exports. Together they handle hub secret injection, outpost agent settings, container installation, and headless execution via `RuntimeRunner`.

## `Runtime`, `Account`, and `Agent`

A `Runtime` object in `packages/factory/contracts/outpost.ts` defines three fields:

| Field | Purpose |
| :--- | :--- |
| `id` | Unique runtime identifier such as `"claude"` or `"droid"`, checked during outpost validation and dispatch |
| `setup` | Root shell script executed during `Dockerfile` image builds to install the CLI globally |
| `runner` | TypeScript source string loaded at container boot, exporting a default `RuntimeRunner` |

`Account` in `contracts/hub.ts` maps container environment variable names to `VaultSecret` bindings via `secrets`.

`Agent` in `contracts/outpost.ts` extends `OutpostGroup` to set its runtime and write settings into the outpost's `agents` map.

Read setup scripts and runner source lazily via getters on `runtime`. That prevents filesystem errors when an outpost isolate imports the plugin package and reads only `runtime.id`.

## Writing `setup.sh`

During container builds in `packages/cloudflare/workers/outpost-source.ts`, the deployer runs `setup` scripts as root before switching to the non-root `factory` user whose home directory is `/data/home`:

- Install prerequisites such as `curl`, `ca-certificates`, and `procps` only if missing so custom Dockerfiles stay fast.
- Install or symlink the agent binary into a global `PATH` directory such as `/usr/local/bin` with world-read and execute permissions for `factory`, rather than `/root/.local/bin`.
- Clean up `/root/.local` or auth state left by installers.

## Implementing `RuntimeRunner`

The container runner loads `runtimes/<id>.ts` dynamically without `node_modules`. Restrict `RuntimeRunner` implementations to Node built-ins and type-only `@notation/factory` imports:

| Member | Behavior |
| :--- | :--- |
| `command` | Required; CLI executable name verified on `PATH` |
| `name` | Required; display name shown in error messages |
| `configDir` | Required; relative config dotdir such as `".claude"` persisted across sleeps |
| `transcripts` | Required; transcript subdirectory relative to `configDir`, such as `"projects"` |
| `configEnv` | Recommended; returns env vars pointing the CLI at `/data/agents/<agent>/<configDir>` |
| `homeFiles` | Optional; home filenames such as `[".claude.json"]` mirrored into `configDir` |
| `args` | Required; builds CLI flags for print mode, permissions, model, and system prompt |
| `input` | Optional; overrides stdin payload when the CLI lacks a system prompt flag |
| `resume` | Required; returns extra CLI arguments to resume a saved session ID |
| `parse` | Required; extracts `result`, `isError`, and `sessionId` from final stdout |
| `message` | Optional; parses an NDJSON stdout line into streaming assistant text |
| `model` | Optional; parses an NDJSON stdout line into the active model identifier |
| `session` | Optional; parses an NDJSON stdout line into the session ID, so the runner can save a new session during the run |
| `tools` | Optional; parses an NDJSON stdout line into the tool calls on it, each a `name` and the tool's `input` as the CLI wrote it, which the runner logs |
| `env` | Optional; extra process environment variables such as `DISABLE_AUTOUPDATER` |

The runner writes `prompt`, or the return value of `input`, to `stdin` rather than passing it as a CLI flag so long threads never hit OS `ARG_MAX` limits.
