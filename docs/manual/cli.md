# CLI Reference

| Command group | Run from | Manages |
| --- | --- | --- |
| `factory infra *` | Infrastructure repo (`factory.infra.ts`) | Central `Router`, `Deployer`, `Vault` and `Connection` resources |
| `factory repo *` | Subscriber repo (`.factory/infra.ts`) | Repo subscription and outpost build status |
| `factory container *` | Subscriber repo (or `--repo <owner/name>`) | Interactive agent sessions (`resume`) and shells (`ssh`) |

The `infra` commands use two kinds of credential. Your local provider credentials create, update and delete the hub (`up` and `down`). Operator auth signs you in to the running hub for everything else (`status`, `replay`, and the router calls `up` and `down` make). See [Secrets](./secrets.md#local-credentials).

## Config files

The CLI reads a config file beside each kind of declaration file: `factory.config.ts` beside the hub's `factory.infra.ts`, and `.factory/config.ts` beside an outpost's `.factory/infra.ts`.

In the hub's repo, an optional `factory.config.ts` loads local credentials before every command, and names the hub's router:

```ts [factory.config.ts]
export default {
  loadEnv: "./with-env.sh", // <-- command prefix run once at startup
  router: "https://acme--prod--router-1a2b3c4d.acme.workers.dev", // <-- the router's URL
};
```

`factory` runs the `loadEnv` command once when it starts and adopts the environment it sets.

The commands that talk to the running hub call the router at `router`: `factory infra status` and `factory infra replay`. `factory infra up` prints the router's URL when it creates the router, and again when the URL changes.

In a subscriber repo, `.factory/config.ts` names the hub's GitHub App for each GitHub connection that `.factory/infra.ts` uses, by the App's ID. `factory repo install` looks up each App's current slug from its ID, so it still finds an App that was renamed on GitHub. The App's ID is on its settings page, and `factory infra up` prints it when it creates the App. The config can also name the repo, for when its `origin` remote names another one, such as an outpost inside a monorepo:

```ts [.factory/config.ts]
export default {
  githubApps: { gh: 123456 }, // <-- the ID of the App of the hub's connection `gh`
  repo: "acme/webapp",
};
```

The deployer reads only `.factory/infra.ts`, and ignores `.factory/config.ts`.

## `factory infra`

### `factory infra up`

Deploy infrastructure changes and reconcile subscribed outposts:

```sh
factory infra up [--dry-run] [--prune] [--credential <id>.<credential>@<hash>=<var>]
```

Plans and applies `factory.infra.ts` and writes secrets to the vault. At the end of every deploy, it asks the router to deploy every repository again, with a request signed with the router's sync key. It doesn't sign you in, so it runs in CI and over SSH. The router deploys, one at a time and from its default branch, each repository that the code host's App can read and that the code host's `allow` includes. It removes the outposts of the other repositories that it has deployed. The router answers before it starts the deploys, and `factory infra up` doesn't wait for them. Run `factory infra status` to see how they went. See [The sync key](./secrets.md#the-sync-key). Each secret is written when its credential has a new version: a `sources.Env` without `track` on every deploy, with `track` when its value changes, and a key that a resource issues once, when the resource is created. See [Secrets](./secrets.md#when-a-value-is-written).

| Step | Authenticates with |
| --- | --- |
| Create and deploy the hub | The container provider's sign-in: Wrangler login or `CLOUDFLARE_API_TOKEN`; `RAILWAY_API_TOKEN` |
| Create GitHub Apps and Slack apps | Your `gh` login and your browser |
| Write secrets to the vault | Each source, e.g. `CLAUDE_CODE_OAUTH_TOKEN` in your environment for `sources.Env` |
| Deploy every repo again | The router's sync key, which Notation state holds; the router does the work with the connection's credentials |

| Flag | Effect |
| --- | --- |
| `--dry-run` | Prints planned infra and outpost diffs without modifying resources |
| `--prune` | Deletes sleeping outpost containers and `/data` disks for unsubscribed repos or removed containers |
| `--credential <id>.<credential>@<hash>=<var>` | Passed to Notation, to supply a credential that deploy can't get again, such as an App's client secret. See [Secrets](./secrets.md#a-credential-that-deploy-cant-get-again). Can be given more than once |

### `factory infra status`

Inspect the health of subscribed outposts and webhook queues:

```sh
factory infra status
```

Signs you in as an operator, then lists every repository that the hub has deployed, and the deliveries that failed in the last 7 days. Needs no provider credentials.

For each repository, it shows the state of its last deploy, the commit it deployed, and when. For each container whose image the router has seen built, it shows the latest build and a link to its log. A container keeps its latest build when a later deploy doesn't rebuild its image. For each failed delivery, it shows its name, such as `github/gh/<id>`, its event and repository, and why each trigger's run couldn't start.

The router keeps each repository's last deploy in its own storage, so `status` makes no calls to GitHub. A repository appears once the hub deploys it after this version of the router.

### `factory infra replay`

Retry deliveries that failed while an outpost was unreachable:

```sh
factory infra replay [<delivery>]
```

Signs you in as an operator and starts the failed runs of every failed delivery again, as new runs, against the outpost config that each repository has now. With `<delivery>`, such as `github/gh/<id>` as `factory infra status` names it, it replays only that delivery. A replayed delivery that fails again gets a new message on its thread, and is kept for another 7 days. Needs no provider credentials. See [Deliveries](./connections.md#deliveries).

### Operator sign-in

`status` and `replay` sign you in to the hub in your browser. The CLI asks the router for the sign-in page, opens it, and listens on `http://127.0.0.1:47219/callback` for the browser to come back. The router checks who signed in against the operator auth, and returns an admin session that lasts 4 hours. The CLI keeps the session in `~/.config/notation-factory/sessions.json`, by the router's URL, and signs you in again when it's about to expire or the router refuses it. See [Operator auth](./secrets.md#operator-auth).

### `factory infra down`

Tear down all outposts and hub resources:

```sh
factory infra down [--dry-run] [--yes]
```

Tears down all outpost containers (`FACTORY_STATUS` cleared), then destroys `Deployer`, `Router`, and cloud project resources in reverse dependency order. Deletes the `Vault`'s secrets. Leaves protected resources (GitHub Apps and Slack apps) and opens their settings in your browser.

| Flag | Effect |
| --- | --- |
| `--dry-run` | Prints resources that would be deleted |
| `--yes` | Skips confirmation prompt |

## `factory repo`

### `factory repo install`

Subscribe the current repository to your hub:

```sh
factory repo install [--dry-run] [--repo <owner/name>]
```

Grants the code host's connection access to the repository and waits for the deploy. Each container's image build shows as the check `factory/build <container>` on the commit:

```text
1. Check .factory/infra.ts against the infra's code host and accounts
2. Open browser to install the GitHub App on the repo (if needed)
3. Poll FACTORY_STATUS until the deploy finishes
4. Open builder authorization URL (if needed) and re-trigger deploy
```

Grants on other platforms, such as inviting the Slack bot to a channel, happen on that platform. A missing one fails the deploy, and `FACTORY_STATUS` says which scope isn't granted.

### `factory repo uninstall`

Unsubscribe the current repository from your hub:

```sh
factory repo uninstall [--dry-run]
```

Opens the GitHub App's installation settings in your browser, waits for removal, and deletes `FACTORY_STATUS`. Outpost containers stay asleep until `factory infra up --prune`.

### `factory repo status`

Check the deployment state of a repository's outpost:

```sh
factory repo status [--repo acme/webapp]
```

Prints the repository's `FACTORY_STATUS` variable (defaults to local `origin` remote).

## `factory container`

### `factory container ssh`

Open an interactive shell or run a one-off command inside an outpost container:

```sh
factory container ssh [--repo <owner/name>] [--container <name>] [-- <cmd...>]
```

Connect to the default container or pass a command to a specific outpost:

```sh
factory container ssh
factory container ssh --repo acme/webapp --container dev -- ls -la /data/worktrees
```

Wakes the outpost container via the `Router` and opens an SSH shell (or runs `<cmd...>`). Requires push access to the repository.

### `factory container resume`

Attach your local terminal to an agent session on a remote worktree:

```sh
factory container resume [conversation] [session] [--repo <owner/name>] [--container <name>]
```

Pick a session interactively or target a specific issue and agent:

```sh
factory container resume              # pick from all sessions in the container
factory container resume 42           # attach to issue #42's session
factory container resume 42 coder     # attach to `coder` on issue #42
```

Wakes the outpost container and attaches the agent's interactive TUI inside the conversation's worktree.

| Argument / Flag | Effect |
| --- | --- |
| `conversation` | Issue number (`42`) to filter sessions; other conversations are picked from the list |
| `session` | Session UUID or agent name (`coder`) |
| `--repo <owner/name>` | Target repository (defaults to `origin` remote) |
| `--container <name>` | Container name when `.factory/infra.ts` declares multiple containers |
