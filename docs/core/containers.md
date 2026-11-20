# Containers

Notation Factory runs agents inside per-container Cloudflare Workers backed by persistent state in R2. While an active container sleeps after 10 minutes of idle time and discards its local disk, Factory snapshots worktree git bundles and agent sessions after every run so the next wake restores where the conversation left off.

## Declaring a container

Define a `Container` in `.factory/infra.ts` with its runtime dependencies, scoped policies, machine size, and startup files:

```ts [.factory/infra.ts]
const dev = new Container("dev", {
  image: "./Dockerfile",
  instanceType: "standard-2",
  runtimes: [claude.runtime, droid.runtime],
  policies: [code, shared],
  files: {
    "~/.npmrc": "./npmrc",
    "~/.claude/settings.json": { cleanupPeriodDays: 30 },
  },
});
```

| Option | Description |
| :--- | :--- |
| `image` | Dockerfile path relative to `.factory/`, built with `.factory/` as context |
| `instanceType` | Machine size name for the provider; defaults to `"standard-1"` on Cloudflare |
| `runtimes` | List of unique runtime definitions whose credentials and CLIs the container needs |
| `policies` | List of policy objects whose short-lived tokens the container may request |
| `files` | Map of `~/...` target paths to `.factory/` file paths or inline JSON objects |

Each container runs at most one instance at a time and sleeps after `sleepAfter` elapses on `cloudflare.Deployer`, which defaults to `"10m"`. Active runs keep the container awake until they finish.

## Cloudflare instance types

On Cloudflare, `instanceType` selects the container size and defaults to `"standard-1"` when omitted:

| Instance type | Notes |
| :--- | :--- |
| `"lite"` | Smallest available instance size |
| `"basic"` | Lightweight tier above `"lite"` |
| `"standard-1"` | Default instance size when `instanceType` is omitted |
| `"standard-2"` | Mid-tier standard instance |
| `"standard-3"` | High-capacity standard instance |
| `"standard-4"` | Largest standard instance |

Passing any unrecognized instance type fails the outpost deploy. See [Cloudflare reference](../reference/cloudflare.md) for deployer-level options such as `regions` and `sleepAfter`.

## Default image and custom Dockerfiles

Without `image`, a container uses Factory's default Debian and Bun image, which includes git, the GitHub CLI, jq, ripgrep, curl, and OpenSSH. When using the default image, the hub must declare an `Account` with a setup script for every runtime in `runtimes`.

Repositories that need extra languages, package managers, or system libraries define a custom Debian or Ubuntu Dockerfile and set `image: "./Dockerfile"`:

```dockerfile [.factory/Dockerfile]
FROM node:24-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gh jq openssh-client ripgrep \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@11
```

Custom Dockerfiles must be Debian-based or Ubuntu-based because the deployer appends layers using `apt-get` and copies a glibc-linked `bun` binary. If a Dockerfile has multiple stages, Factory appends its layers to the final stage.

## Injected layers and startup

The deployer appends Factory's runtime layers to the end of every Dockerfile – default or custom – before building the image:

1. Switches to `root` and copies `bun` from `oven/bun:1-debian` to `/usr/local/bin/bun`.
2. Installs `ca-certificates` and `git` via `apt-get` if `git` is not already present.
3. Copies each listed runtime's `setup.sh` into `/tmp/factory-runtimes/`, executes them as `root`, and removes the directory.
4. Creates the `factory` user with home `/data/home` if absent and assigns ownership of `/data`.
5. Switches to `USER factory`, sets `HOME=/data/home` and `WORKDIR /data/home`, and exposes port `8080`.

The outpost Worker overrides the image entrypoint and command to fetch `http://runner.factory/runner.ts` at startup and listen on port `8080`. Any user, working directory, home path, entrypoint, or command set in a custom Dockerfile is replaced.

## Image builds and commit checks

When a deploy changes a container's source – `.factory/` files, the default Dockerfile, or the outpost Worker bundle – the deployer pushes a root commit to a Cloudflare Artifacts repository and triggers Workers Builds.

Each container build reports progress on the pushed GitHub commit as a check named `factory/build <container>`, such as `factory/build dev`:

| Check state | Meaning |
| :--- | :--- |
| `queued` | Deployer pushed container source to its Artifacts repository |
| `in_progress` | Workers Builds started building; details link to the Cloudflare build log |
| `success` | Image built and the container's outpost Worker deployed |
| `failure` | Build failed or timed out after 2 hours; next push rebuilds automatically |
| `cancelled` | Build was cancelled; next push rebuilds automatically |

If an event triggers a run before the container's first image build completes, the router posts `> Booting container \`<container>\`...` on the thread and polls every 30 seconds for up to 3 hours before failing.

## GitHub policies and token refresh

Containers never hold the hub's GitHub App private key. Declare `github.Policy` objects to grant 1-hour installation tokens scoped to a repository and specific permissions:

```ts [.factory/infra.ts]
const code = new github.Policy("code", {
  permissions: { contents: "write", pull_requests: "write" },
});

const shared = new github.Policy("shared", {
  repo: "acme/shared-types",
  permissions: { contents: "read" },
});
```

| Policy field | Description |
| :--- | :--- |
| `repo` | Target `owner/name` repository; defaults to the outpost's own repository |
| `permissions` | Map of GitHub App permissions set to `"read"` or `"write"` |

Supported permission keys are listed below:

| Permission | Scope |
| :--- | :--- |
| `contents`, `pull_requests`, `issues` | Repository code, branches, pull requests, and issue threads |
| `actions`, `actions_variables`, `checks`, `statuses` | Workflows, Actions variables, check runs, and commit statuses |
| `deployments`, `metadata` | Deployments and repository metadata |

Before each run, the router mints one token per policy plus a read-only clone token for the outpost repo. The runner writes policy tokens atomically to `/data/github/<policy>`, sets `FACTORY_TOKEN_FILE` to the token file matching the run's repo, and refreshes tokens via `/tokens` every 30 minutes during long runs.

GitHub's runner setup configures a global `git` credential helper and a `/data/bin/gh` wrapper – when `gh` is installed – that read `FACTORY_TOKEN_FILE` on each invocation so refreshed tokens take effect immediately.

## Persistence across container sleep

When a container sleeps, everything on its local filesystem is discarded. After every run – whether it succeeds or fails – the runner persists worktree and session state to the hub's R2 bucket through `http://state.factory`.

```text [/data/]
/data/
├── home/                                # Shared $HOME for non-config startup files
├── agents/<agent>/                      # Isolated per-agent runtime config and transcripts
├── repos/<repo>.git                     # Bare repository clone, ephemeral
├── worktrees/<repo>/<branch>/           # Branch worktree checkout
├── scratch/<conversation>/              # Detached scratch checkout
├── sessions/<conversation>/<agent>.json # Saved session ID, cwd, and seen message hashes
├── github/                              # Refreshed policy token files, ephemeral
└── bin/                                 # Token-reading CLI wrappers such as gh, ephemeral
```

| Data | Persists across sleep |
| :--- | :--- |
| Branch and scratch worktree git bundles | Yes, committed on top of `HEAD` excluding gitignored files and `origin` commits |
| Agent session state files | Yes, stores session ID, worktree path, and seen message hashes |
| Runtime session transcript files | Yes, archived as a `.tar.gz` from the agent's transcript directory |
| Bare repository clones | No, re-cloned and fetched from `origin` on container wake |
| Gitignored untracked files | No, directories such as `node_modules` are excluded from the git bundle |
| Startup files, tokens, and wrappers | No, rewritten from `.factory/` and fresh router tokens on each run |

If you rely on dependencies such as `node_modules`, have the agent run install commands or check whether dependencies are present when resuming after a sleep. Next, see [Agents](./agents.md) to configure runtimes, prompts, and per-agent isolation.
