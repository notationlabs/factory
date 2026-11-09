# Containers & Policies

| Ephemeral CI runner | Outpost `Container` |
| --- | --- |
| Fresh VM per run; disk discarded on exit | Sleeps when idle; `/data` disk persists across runs |
| Long-lived secrets in environment variables | Short-lived tokens minted on demand by `Router` |

Provision a persistent machine for your repository's agents:

```ts [.factory/config.ts]
const dev = new Container("dev", {
  image: "./Dockerfile",
  runtimes: [claude.runtime], // <-- installed at image build, matched to an infra Account
  policies: [code, shared],   // <-- credentials the container is allowed to mint
  files: {
    "~/.npmrc": "./npmrc",    // <-- copies .factory/npmrc to /data/home/.npmrc
  },
});
```

`Container` declares an outpost machine: its Docker image, the runtimes it installs, the `Policy` objects it can request tokens for, and startup files written into `/data/home`.

## Dockerfile

Install your project's toolchain alongside the Notation Factory runner, then the container's runtimes:

```dockerfile [.factory/Dockerfile]
FROM node:22.18-bookworm
RUN npm install -g bun@1.4.3

# Repo-specific packages and toolchains
RUN apt-get update && apt-get install -y jq postgresql-client && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://raw.githubusercontent.com/notationlabs/factory/main/install.sh | sh
RUN --mount=type=bind,from=runtime,target=/runtime sh /runtime/setup.sh
```

| Requirement | Reason |
| --- | --- |
| **Debian/Ubuntu base** | `install.sh` uses `apt-get` to install `git`, `gh`, `curl`, and process tools |
| **Global `bun`** | `/usr/local/bin/factory-runner` runs `@notation/factory-runner` with `bunx`, at the version the deployer gives the container, and installs the infrastructure's plugins under `/data/plugins` |
| **`runtime` mount** | The deployer builds the `runtime` context from the container's runtimes |
| **System-wide paths** | Runner drops privileges to user `agent` (`HOME=/data/home`) |
| **No `CMD` / `ENTRYPOINT`** | Container provider starts `/usr/local/bin/factory-runner` directly |

## Runtimes

The Dockerfile has one `runtime` mount, however many runtimes the container lists. The deployer puts each runtime's setup under its own id, and generates a `setup.sh` that runs them in the order the container lists them:

```text
runtime/
  setup.sh          # generated: runs each runtime's setup in order, stopping at the first failure
  claude/setup.sh
  codex/setup.sh
```

Runtime setups must not depend on each other, and listing the same runtime twice in one container is a config error. At run time, the deployer injects the credentials of every infra `Account` whose runtime the container lists, and only those.

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

State persists across runs and image rebuilds on the `/data` volume:

```text
/data/
├── home/                        # $HOME for the unprivileged `agent` user
├── mirror.git/                  # bare git mirror (worktrees branch locally in ms)
├── config/<commit>/             # `.factory/` as of each event's commit
├── worktrees/<branch>/          # git checkout per branch a worktree function returns
├── scratch/<conversation>/      # detached checkout per conversation without a branch
├── agents/<agent>/              # isolated config and transcripts per Agent
├── sessions/<conversation>.json # each agent's session in the conversation
└── github/                      # short-lived code host tokens
```

`factory container ssh` opens a shell inside `/data`.
