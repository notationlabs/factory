# Containers

Notation Factory runs agents inside per-container Cloudflare Workers backed by persistent state in R2. While an active container sleeps after 10 minutes of idle time and discards its local disk, Factory snapshots worktree git bundles and agent sessions during and after every run so the next wake restores where the conversation left off.

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
| `instanceType` | Machine size: a provider's size name, or `{ vcpu, memoryMib, diskMb }`; defaults to `"standard-1"` on Cloudflare |
| `runtimes` | List of unique runtime definitions whose credentials and CLIs the container needs |
| `policies` | List of policy objects whose short-lived tokens the container may request |
| `files` | Map of `~/...` target paths to `.factory/` file paths or inline JSON objects |

## Instances and worktrees

Each worktree gets its own instance of the container. Runs on the branch `issue-127` go to one instance, and runs on `issue-128` go to another, so they run in parallel. Runs without a branch get a scratch worktree for each conversation, and each of those conversations gets its own instance too. Runs in the same worktree queue on that worktree's instance and run one at a time.

A container runs at most `maxInstances` instances at once, set on `cloudflare.Deployer`, which defaults to `5`. An instance sleeps after `sleepAfter` elapses with no run in progress, which defaults to `"10m"`. Active runs keep the instance awake until they finish. A sleeping instance does not count towards `maxInstances`.

A new instance starts with an empty disk. It clones the repo and restores the worktree and the agent's session from the saved state, which all instances of a container share. See [Persistence across container sleep](#persistence-across-container-sleep).

When all `maxInstances` instances are awake, Cloudflare refuses to start another one. A run that needs a new instance then waits:

1. The run tries to start an instance for up to 5 minutes.
2. If no instance is free, it posts a notice on the thread that it is waiting, and tries again every minute.
3. When an instance starts, the run's reply replaces the notice.
4. If no instance is free after 30 minutes, the run fails and replaces the notice with a message that says so. Mention the agent again to retry.

Cloudflare gives the same error while it provisions a new image, so the notice says that too. An instance stays awake for `sleepAfter` after its last run, so a waiting run usually gets an instance within that time.

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

Passing any unrecognized instance type fails the outpost deploy.

For a size between or above the named types, give the resources instead of a name. The deployer passes them to Wrangler as a custom `instance_type`:

```ts [.factory/infra.ts]
const dev = new Container("dev", {
  instanceType: { vcpu: 2, memoryMib: 10240, diskMb: 16000 },
  runtimes: [claude.runtime],
});
```

| Field | Unit | Cloudflare minimum |
| :--- | :--- | :--- |
| `vcpu` | vCPUs, fractions allowed | `0.0625` |
| `memoryMib` | MiB | `256` |
| `diskMb` | MB | `2000` |

A size under a minimum fails the outpost deploy. The maximums are the account's per-instance limits, by default 4 vCPU, 12 GiB of memory, and 20 GB of disk. Cloudflare can raise them on request. Wrangler checks a size against the account's limits when the image builds, and a size over them fails the build. See [Cloudflare reference](../reference/cloudflare.md) for deployer-level options such as `regions` and `sleepAfter`.

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
3. Installs `earlyoom` via `apt-get` if it is not already present and the image has `apt-get`.
4. Copies each listed runtime's `setup.sh` into `/tmp/factory-runtimes/`, executes them as `root`, and removes the directory.
5. Creates the `factory` user with home `/data/home` if absent and assigns ownership of `/data`.
6. Switches to `USER factory`, sets `HOME=/data/home` and `WORKDIR /data/home`, and exposes port `8080`.

The outpost Worker overrides the image entrypoint and command to fetch `http://runner.factory/runner.ts` at startup and listen on port `8080`. Any user, working directory, home path, entrypoint, or command set in a custom Dockerfile is replaced.

## Memory limits and earlyoom

A container that runs out of memory can stop responding for many minutes before the kernel stops a process. While it doesn't respond, the run can't save its work or post a reply. To prevent this, the runner starts [earlyoom](https://github.com/rfjakob/earlyoom) when the container starts. earlyoom stops the process with the highest OOM score once less than 10% of the container's memory is available. Swap doesn't delay it.

The runner gives the agent's CLI, and every process the agent starts, a higher OOM score than its own. So earlyoom stops the agent's processes, such as a `tsc` or a test run that uses too much memory, before the runner. The run's reply then ends with a note such as:

> earlyoom stopped `tsc` (3.1 GiB) because the container was out of memory.

The agent usually sees its command fail, and can carry on. If earlyoom stops the agent's CLI, the run fails, and its reply has the error and the note.

earlyoom writes a memory report to the container's logs every 60 seconds, and a line for each process it stops. Debian 12 has earlyoom 1.7 and Debian 13 has 1.8. The runner reads the output of both.

If the image has no `earlyoom`, because it has no `apt-get`, the runner logs `earlyoom missing` and runs without it.

### Node's heap limit

earlyoom protects every container. Factory doesn't set `NODE_OPTIONS`. If a repo has a Node tool that needs more memory than Node allows by default, or that should fail before it fills the container, set the heap limit in the container's own Dockerfile:

```dockerfile [.factory/Dockerfile]
ENV NODE_OPTIONS=--max-old-space-size=4096
```

The value is in MiB. Leave room for the agent's CLI and the other processes in the container.

## Image builds and commit checks

When a deploy changes a container's source – `.factory/` files, the default Dockerfile, or the outpost Worker bundle – the deployer pushes a root commit to a Cloudflare Artifacts repository and triggers Workers Builds.

Each container build reports progress on the pushed GitHub commit as a check named `factory/build <container>`, such as `factory/build dev`:

| Check state | Meaning |
| :--- | :--- |
| `queued` | Deployer pushed container source to its Artifacts repository |
| `in_progress` | Workers Builds started building, or the deployer is about to start a failed build again; details link to the Cloudflare build log |
| `success` | Image built and the container's outpost Worker deployed |
| `failure` | Build failed twice, or timed out after 2 hours; next push rebuilds automatically |
| `cancelled` | Build was cancelled; next push rebuilds automatically |

When a build fails or is terminated, the deployer waits 2 minutes and starts it once more. Failures on Cloudflare's side, such as a timeout while pushing the image to the registry, often pass in that time. The deployer skips the retry if a newer source has been pushed, because that source is already building. If the second build also fails, the check reports `failure`.

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

When a container sleeps, everything on its local filesystem is discarded. Every 60 seconds during a run, and after every run – whether it succeeds or fails – the runner persists worktree and session state to the hub's R2 bucket through `http://state.factory`. A save uploads nothing when the worktree and the session's transcript haven't changed since the last save.

If the container stops or fails during a run, the work up to the last save is kept. The next run in the same worktree and conversation restores it, resumes the agent's session, and gives the agent the lost run's messages again.

The runner sends the router a heartbeat every minute for each run it holds, and the outpost Worker sends them while it starts the run's container or waits for a free instance. If a run sends none for 5 minutes, such as when its container stops responding, the router marks the run lost and replaces the run's message on the thread with a notice that says so. If the container recovers and the run is still going, the runner stops the run's agent and saves its work. The notice has a link that restarts the run. The link signs you in with GitHub, checks that the trigger's `from` lets you start a run, and starts the run again from the last save. It works for 7 days. You can also mention the agent again.

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
