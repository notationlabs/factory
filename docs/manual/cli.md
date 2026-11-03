# CLI Reference

| Command group | Run from | Manages |
| --- | --- | --- |
| `lightbox infra *` | Infrastructure repo (`lightbox.infra.ts`) | Central `Router`, `Deployer`, `Vault` and `Connection` resources |
| `lightbox repo *` | Subscriber repo (`.lightbox/config.ts`) | Repo subscription and outpost build status |
| `lightbox container *` | Subscriber repo (or `--repo <owner/name>`) | Interactive agent sessions (`resume`) and shells (`ssh`) |

The `infra` commands use two kinds of credential. Your local provider credentials create, update and delete the hub (`up` and `down`). Operator auth signs you in to the running hub for everything else (`status`, `replay`, and the router calls `up` and `down` make). See [Secrets](./secrets.md#local-credentials).

## `lightbox.config.ts`

An optional `lightbox.config.ts` beside `lightbox.infra.ts` loads local credentials before every command:

```ts [lightbox.config.ts]
export default {
  loadEnv: "./with-env.sh", // <-- command prefix run once at startup
};
```

`lightbox` runs the command once when it starts and adopts the environment it sets.

## `lightbox infra`

### `lightbox infra up`

Deploy infrastructure changes and reconcile subscribed outposts:

```sh
lightbox infra up [--dry-run] [--prune]
```

Plans and applies `lightbox.infra.ts`, writes new or changed secrets to the vault, then signs you in as an operator and syncs all subscribed repositories.

| Step | Authenticates with |
| --- | --- |
| Create and deploy the hub | The container provider's sign-in: Wrangler login or `CLOUDFLARE_API_TOKEN`; `RAILWAY_API_TOKEN` |
| Create GitHub Apps and Slack apps | Your `gh` login and your browser |
| Copy account secrets into the vault | The values in your environment, e.g. `CLAUDE_CODE_OAUTH_TOKEN` |
| Read and set App webhooks, sync repos | Operator auth; the router does the work with the connection's credentials |

| Flag | Effect |
| --- | --- |
| `--dry-run` | Prints planned infra and outpost diffs without modifying resources |
| `--prune` | Deletes sleeping outpost containers and `/data` disks for unsubscribed repos or removed containers |

### `lightbox infra status`

Inspect the health of subscribed outposts and webhook queues:

```sh
lightbox infra status
```

Signs you in as an operator, then lists every subscribed repository (deploy state, timestamp, containers) and any deliveries in the `failed` queue. Needs no provider credentials.

### `lightbox infra replay`

Retry deliveries that failed while an outpost was unreachable:

```sh
lightbox infra replay
```

Signs you in as an operator and re-queues failed deliveries against each outpost container's current URL and configuration. Needs no provider credentials.

### `lightbox infra down`

Tear down all outposts and hub resources:

```sh
lightbox infra down [--dry-run] [--yes]
```

Tears down all outpost containers (`LIGHTBOX_STATUS` cleared), then destroys `Deployer`, `Router`, and cloud project resources in reverse dependency order. Leaves protected resources (the `Vault`, GitHub Apps and Slack apps) and opens their settings in your browser.

| Flag | Effect |
| --- | --- |
| `--dry-run` | Prints resources that would be deleted |
| `--yes` | Skips confirmation prompt |

## `lightbox repo`

### `lightbox repo install`

Subscribe the current repository to your hub:

```sh
lightbox repo install [--dry-run]
```

Grants the code host's connection access to the repository and waits for the initial container build:

```text
1. Check .lightbox/config.ts against the infra's code host and accounts
2. Open browser to install the GitHub App on the repo (if needed)
3. Poll LIGHTBOX_STATUS until outpost containers finish building
4. Open builder authorization URL (if needed) and re-trigger deploy
```

Grants on other platforms, such as inviting the Slack bot to a channel, happen on that platform. A missing one fails the deploy, and `LIGHTBOX_STATUS` says which scope isn't granted.

### `lightbox repo uninstall`

Unsubscribe the current repository from your hub:

```sh
lightbox repo uninstall [--dry-run]
```

Opens the GitHub App's installation settings in your browser, waits for removal, and deletes `LIGHTBOX_STATUS`. Outpost containers stay asleep until `lightbox infra up --prune`.

### `lightbox repo status`

Check the deployment state of a repository's outpost:

```sh
lightbox repo status [--repo acme/webapp]
```

Prints the repository's `LIGHTBOX_STATUS` variable (defaults to local `origin` remote).

## `lightbox container`

### `lightbox container ssh`

Open an interactive shell or run a one-off command inside an outpost container:

```sh
lightbox container ssh [--repo <owner/name>] [--container <name>] [-- <cmd...>]
```

Connect to the default container or pass a command to a specific outpost:

```sh
lightbox container ssh
lightbox container ssh --repo acme/webapp --container dev -- ls -la /data/worktrees
```

Wakes the outpost container via the `Router` and opens an SSH shell (or runs `<cmd...>`). Requires push access to the repository, and on Cloudflare one of the deployer's `knownHosts`.

### `lightbox container resume`

Attach your local terminal to an agent session on a remote worktree:

```sh
lightbox container resume [conversation] [session] [--repo <owner/name>] [--container <name>]
```

Pick a session interactively or target a specific issue and agent:

```sh
lightbox container resume              # pick from all sessions in the container
lightbox container resume 42           # attach to issue #42's session
lightbox container resume 42 coder     # attach to `coder` on issue #42
```

Wakes the outpost container and attaches the agent's interactive TUI inside the conversation's worktree.

| Argument / Flag | Effect |
| --- | --- |
| `conversation` | Issue number (`42`) to filter sessions; other conversations are picked from the list |
| `session` | Session UUID or agent name (`coder`) |
| `--repo <owner/name>` | Target repository (defaults to `origin` remote) |
| `--container <name>` | Container name when `.lightbox/config.ts` declares multiple containers |
