# Worktrees & Session State

Notation Factory containers use ephemeral `/data` disks that vanish whenever Cloudflare sleeps the instance. After every run, `perform` (`packages/factory/runner/index.ts`) snapshots modified worktrees as incremental git bundles and archives per-agent transcript directories to R2 through `http://state.factory`.

```mermaid [Runner state persistence flow]
sequenceDiagram
  participant Runner as Runner (/data)
  participant Proxy as OutpostContainer (state.factory)
  participant Deployer as DeployerWorker (RPC)
  participant R2 as Hub R2 Bucket

  Runner->>Proxy: GET /worktrees/<branch>.bundle
  Proxy->>Deployer: getState(containerId, key)
  Deployer->>R2: get(outposts/<id>/<key>)
  Note over Runner: Run agent CLI in worktree
  Runner->>Proxy: PUT /worktrees/<branch>.bundle + sessions/*.tar.gz
  Proxy->>Deployer: putState(containerId, key, stream)
  Deployer->>R2: put(outposts/<id>/<key>)
```

## Container storage proxy (`state.factory`)

Outpost containers do not hold R2 credentials. Instead, `OutpostContainer.outboundByHost` in `packages/cloudflare/workers/outpost.ts` intercepts requests to `http://state.factory/<key>` via `@cloudflare/containers`.

The proxy validates keys against path traversal and forwards reads and streams to `DeployerWorker` under the `outposts/<containerId>/<key>` prefix.

## Git bundle worktree snapshots

The runner stores clones and active checkouts under `/data` using three path layouts:

| Path | Contents |
| :--- | :--- |
| `/data/repos/<slug(repo)>.git` | Bare repository clone updated via `git fetch --prune` |
| `/data/worktrees/<slug(repo)>/<branch>` | Checkout for branch-bound triggers |
| `/data/scratch/<slug(convId)>` | Detached scratch checkout per conversation |

After each run completes or fails, `saveWorktree` avoids mutating the user's staging area or history:

1. Copies the worktree's index into a temporary `GIT_INDEX_FILE` and runs `git add --all` to capture tracked, modified, and unignored untracked files.
2. Runs `git write-tree` and `git commit-tree` on top of `HEAD` to record an ephemeral commit under `refs/factory/worktrees/<branch>` or scratch refs.
3. Runs `git bundle create ... --not --remotes=origin` so the uploaded bundle contains only local commits and uncommitted changes relative to `origin`.

On a cold container start, `restoreWorktree` fetches the snapshot commit from the bundle, adds the worktree at the parent commit, resets tracked and untracked state via `git read-tree` and `git reset`, and restores upstream tracking.

Gitignored build artifacts such as `node_modules` stay outside snapshot bundles and regenerate on demand.

## Per-agent config and session persistence

Runtimes that support relocating their configuration directory isolate state per agent ID under `/data/agents/<slug(agent.id)>/<configDir>`:

| Runtime | Config environment variable |
| :--- | :--- |
| `claude` | `CLAUDE_CONFIG_DIR` |
| `cursor` | `CURSOR_CONFIG_DIR` |
| `droid` | `FACTORY_HOME_OVERRIDE` |

Container `files` apply before agent `files`, routing matching home config paths into that isolated directory.

Runner stores session IDs, working directories, and seen message hashes in `/data/sessions/<conv>/<agent>.json`, scoped per agent so distinct runtimes never resume each other's sessions.

Each post-run save uploads that metadata file and a gzip tarball of matching transcript files to `sessions/<conv>/<agent>.tar.gz`.
