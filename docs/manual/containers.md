# Containers & Policies

| Ephemeral CI runner | Outpost `Container` |
| --- | --- |
| Fresh VM per run; disk discarded on exit | Sleeps when idle; worktrees and sessions persist across runs |
| Long-lived secrets in environment variables | Short-lived tokens minted on demand by `Router` |

Provision a persistent machine for your repository's agents:

```ts [.factory/infra.ts]
const dev = new Container("dev", {
  image: "./Dockerfile",      // <-- optional; defaults to Factory's image
  instanceType: "standard-2", // <-- optional; the machine's size, in the provider's names
  runtimes: [claude.runtime], // <-- matched to an infra Account
  policies: [code, shared],   // <-- credentials the container is allowed to mint
  files: {
    "~/.npmrc": "./npmrc",    // <-- copies .factory/npmrc to /data/home/.npmrc
  },
});
```

`Container` declares an outpost machine: its image, its size, the runtimes the image has, the `Policy` objects it can request tokens for, and startup files written into `/data/home`.

## Image

A container without `image` runs Factory's default image, built from [`packages/cloudflare/image/Dockerfile`](../../packages/cloudflare/image/Dockerfile). It has `bun`, `git`, `gh`, `jq` and `ripgrep`.

A repo that needs its own toolchain writes a Dockerfile in `.factory/`, and sets `image` to its path. The Dockerfile only installs the toolchain. This one adds `postgresql-client` to the tools of the default image:

```dockerfile [.factory/Dockerfile]
FROM oven/bun:1-debian

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gh jq openssh-client ripgrep postgresql-client \
 && rm -rf /var/lib/apt/lists/*
```

The deployer adds Factory's layers to the end of every Dockerfile, the default one and a repo's own. As root, they:
1. Copy `bun` from `oven/bun:1-debian`. The container's entrypoint runs `bun -e`, which fetches the runner from `http://runner.factory` and runs it.
2. Install `git` if the image has none. The runner clones the repo, and saves each worktree as a git bundle.
3. Run the setup of each runtime the container lists, from its plugin, which installs the runtime's CLI.
4. Create the user `factory`, unless the image has one, and give it `/data`. Claude Code refuses `--dangerously-skip-permissions` as root, and the runner keeps its state in `/data`.

Then they switch to `factory`, with `/data/home` as its home and working directory.

So the image must be based on Debian or Ubuntu: the layers and the setups install packages with `apt-get`, and the `bun` they copy is built for glibc. A Dockerfile with more than one stage gets the layers in its last stage. Its `USER`, `WORKDIR` and `HOME` are replaced, and so are its `ENTRYPOINT` and `CMD`, by the container's entrypoint.

The image holds nothing from Factory but those layers. The entrypoint fetches the runner from the outpost Worker each time the container starts, and the runner fetches the plugins' runner modules for each run, so the image doesn't change when Factory does.

`gh` is optional. The code host's runner module puts a `gh` in `/data/bin` that runs the image's `gh` with the run's token, so agents can open pull requests.

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

Each runtime's plugin ships two files:
- `setup.sh`, which installs its CLI. The deployer adds it to the container's build context as `factory-runtimes/<id>.sh`, and Factory's layers run it. A container with no `image` fails its deploy if the hub has no setup for one of its runtimes. A repo's own Dockerfile can install the CLI itself instead.
- A runner module, which says how the runner runs the CLI: its arguments, how it resumes a session, and where it keeps transcripts. The hub serves it to containers, and the runner imports it for each run of the runtime's agents. A run fails if the hub has no runner module for its agent's runtime.

The code host's plugin ships a runner module too, which clones the repo, and sets up git and `gh` to push with the run's token. Listing the same runtime twice in one container is a config error.

## Policies

Grant the container scoped code host access to the repositories it needs:

```ts [.factory/infra.ts]
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
| **Run time** | The code host's runner module configures `git`'s credential helper inside the container to read the run's token |

Channel access is separate: containers read and reply on conversations through the router's [channel relay](./connections.md#channel-relay), never with a channel token.

## Volume layout

The runner keeps its state under `/data`:

```text
/data/
├── home/                          # $HOME for the image's user
├── repos/<repo>.git               # bare clone of each repo
├── worktrees/<repo>/<branch>/     # git checkout per branch a worktree function returns
├── scratch/<conversation>/        # detached checkout per conversation without a branch
├── sessions/<conversation>/<agent>.json  # each agent's session in the conversation
├── github/                        # short-lived code host tokens
└── bin/                           # the `gh` that uses the run's token
```

A container's disk doesn't survive sleep. So after each run, the runner saves the worktree and the agent's session to the hub, and a new container restores them at the next run.

`factory container ssh` opens a shell inside `/data`.
