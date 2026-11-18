# Containers & Policies

| Ephemeral CI runner | Outpost `Container` |
| --- | --- |
| Fresh VM per run; disk discarded on exit | Sleeps when idle; worktrees and sessions persist across runs |
| Long-lived secrets in environment variables | Short-lived tokens minted on demand by `Router` |

Provision a persistent machine for your repository's agents:

```ts [.factory/config.ts]
const dev = new Container("dev", {
  image: "./Dockerfile",      // <-- optional; defaults to Factory's image
  runtimes: [claude.runtime], // <-- matched to an infra Account
  policies: [code, shared],   // <-- credentials the container is allowed to mint
  files: {
    "~/.npmrc": "./npmrc",    // <-- copies .factory/npmrc to /data/home/.npmrc
  },
});
```

`Container` declares an outpost machine: its image, the runtimes the image has, the `Policy` objects it can request tokens for, and startup files written into `/data/home`.

## Image

A container without `image` runs Factory's default image, built from [`packages/cloudflare/image/Dockerfile`](../../packages/cloudflare/image/Dockerfile). It has `bun`, `git`, `gh`, `jq` and `ripgrep`, plus the CLI of each runtime the container lists, installed by the runtime plugin's `setup.sh`.

A repo that needs its own toolchain writes a Dockerfile in `.factory/`, and sets `image` to its path. The deployer adds the setup of each of the container's runtimes to the build context, as `factory-runtimes/<id>.sh`; the Dockerfile runs them, as root, before its user. This Dockerfile extends Factory's default with `postgresql-client`:

```dockerfile [.factory/Dockerfile]
FROM oven/bun:1-debian

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gh jq openssh-client ripgrep \
 && apt-get install -y --no-install-recommends postgresql-client \
 && rm -rf /var/lib/apt/lists/*

# The container's runtimes' setups, from the hub's plugins.
COPY factory-runtimes /tmp/factory-runtimes
RUN for setup in /tmp/factory-runtimes/*.sh; do sh "$setup"; done \
 && rm -rf /tmp/factory-runtimes

# Claude Code refuses --dangerously-skip-permissions as root.
RUN useradd --create-home --home-dir /data/home --shell /bin/bash factory \
 && chown -R factory:factory /data
USER factory
ENV HOME=/data/home
WORKDIR /data/home
```

The image holds nothing from Factory. The container's entrypoint fetches the runner from the outpost Worker each time the container starts, so the image doesn't change when Factory does. The entrypoint replaces the image's `ENTRYPOINT` and `CMD`.

Each image needs these:

| Requirement | Reason |
| --- | --- |
| **`bun`** | The entrypoint runs `bun -e`, which fetches the runner from `http://runner.factory` and runs it |
| **`git`** | The runner clones the repo, and saves each worktree as a git bundle |
| **The `factory-runtimes` contract lines** | They install the CLI of each runtime the container lists, from its plugin's setup. The runner checks for the CLI before each run, and fails the run if it's missing |
| **A user other than root, who can write `/data`** | Claude Code refuses `--dangerously-skip-permissions` as root, and the runner keeps its state in `/data` |
| **A working directory that the user can read** | Git fails in a directory it can't read, such as `oven/bun`'s `/home/bun/app` |

`gh` is optional. The runner puts a `gh` in `/data/bin` that runs the image's `gh` with the run's token, so agents can open pull requests.

### Builds

The deployer builds the image when a push to the default branch changes the container's source. The source is `.factory/`, and also Factory's default Dockerfile and outpost Worker, which change when you update the hub. On Cloudflare:
1. The deployer commits the source to an Artifacts repo for the container.
2. Workers Builds builds the image, with `.factory/` as its context, and deploys the container's outpost Worker.

Each build shows as a check on the pushed commit, named after the container: `factory/build dev` for acme/webapp's `dev` container.

| Check | When |
| --- | --- |
| Queued | The deployer pushed the container's source |
| In progress | Workers Builds started the build. The check's details link to the build's log |
| Success, failure or cancelled | The build stopped. After a failure, the next push builds the container again, even if `.factory/` didn't change |

A push that doesn't change a container's source starts no build, and gets no check for that container. A run that arrives before the first build finishes fails, with a message that the container has no image yet. See [Providers](./providers.md#cloudflare).

## Runtimes

A runtime is an id, such as `claude` for `claude.runtime`. Listing a runtime in a container does two things:
- The deployer gives the container the credentials of each infra `Account` whose runtime it lists, and only those.
- The runner checks the image for the runtime's CLI before each run.

Each runtime's plugin ships the `setup.sh` that installs its CLI, and the deployer adds it to the container's build context as `factory-runtimes/<id>.sh`. A container with no `image` runs the setups in its default Dockerfile; a repo's own Dockerfile runs them with the contract lines above. Listing the same runtime twice in one container is a config error.

## Policies

Grant the container scoped code host access to the repositories it needs:

```ts [.factory/config.ts]
const code = new github.Policy("code", {
  permissions: { contents: "write", pull_requests: "write" }, // <-- current repo (acme/webapp)
});

const shared = new github.Policy("shared", {
  repo: "acme/shared", // <-- cross-repo read access
  permissions: { contents: "read" },
});
```

Outpost containers never hold connection credentials or cloud API tokens. They request short-lived code host tokens from the `Router` before each run:

```text
Container ("dev" in acme/webapp)
  │
  │  1. requests tokens over private network
  ▼
Notation Factory Router
  │  2. verifies policies deployed for acme/webapp "dev"
  │  3. asks the code host to mint 1-hour tokens scoped to [code, shared]
  ▼
Container writes tokens to /data/github/ and refreshes them during long runs
```

| Stage | Verification |
| --- | --- |
| **Deploy time** | The code host validates every policy: each credential must cover only its repo and permissions, and expire soon. A code host that can't guarantee that fails the deploy |
| **Run time** | Runner configures `git` credential helpers inside the container to pick the matching token per repository URL |

Channel access is separate: containers read and reply on conversations through the router's [channel relay](./connections.md#channel-relay), never with a channel token.

## Volume layout

The runner keeps its state under `/data`:

```text
/data/
├── home/                          # $HOME for the image's user
├── repos/<repo>.git               # bare clone of each repo
├── worktrees/<repo>/<branch>/     # git checkout per branch a worktree function returns
├── scratch/<conversation>/        # detached checkout per conversation without a branch
├── sessions/<conversation>.json   # each agent's session in the conversation
├── github/                        # short-lived code host tokens
└── bin/                           # the `gh` that uses the run's token
```

A container's disk doesn't survive sleep. So after each run, the runner saves the worktree and the agent's session to the hub, and a new container restores them at the next run.

`factory container ssh` opens a shell inside `/data`.
