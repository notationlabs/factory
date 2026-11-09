# Declaring Infra

Stand up a central hub to serve all of your repositories:

```ts [factory.infra.ts]
import { factory, secret } from "@notation/factory";
import * as claude from "@notation/factory-claude";
import * as cloudflare from "@notation/factory-cloudflare";
import * as github from "@notation/factory-github";
import * as slack from "@notation/factory-slack";

export default factory(() => {
  const vault = new cloudflare.Vault("vault"); // <-- where the hub's secrets live
  const router = new cloudflare.Router("router", { project: "acme-agents", vault });

  const gh = new github.Connection("gh", { name: "acme-agents", org: "acme", router });

  new github.CodeHost("github", {
    connection: gh,             // <-- GitHub mints narrow tokens through the App
    allow: [{ owner: "acme" }], // <-- only repos owned by "acme" get outposts
  });

  new slack.Connection("slack", { name: "acme-agents", workspace: "acme", router });

  new github.OperatorAuth("operators", { connection: gh, logins: ["djgrant", "alice"] });

  const claudeAccount = new claude.Account("claude", {
    auth: secret.env("CLAUDE_CODE_OAUTH_TOKEN"), // <-- what outposts' Claude agents run on
  });

  new cloudflare.Deployer("deployer", {
    router,
    vault,
    accounts: [claudeAccount],
  });
});
```

Each repository then declares its own outpost in [`.factory/config.ts`](./outposts.md), while `factory.infra.ts` owns the shared services:

| Component | Exposure | Role |
| --- | --- | --- |
| `Router` | Public, always on | Receives every connection's events, matches triggers, relays channel replies, mints short-lived code host tokens |
| `Deployer` | Private, sleeps when idle | Checks and builds outpost containers for the repos the code host allows |
| `Vault` | Private | Holds the hub's secrets. `Router` and `Deployer` both take it, and only they read it. See [Secrets](./secrets.md) |
| `Connection` | External platform | Notation Factory's presence on a platform: its credentials, bot identity and event feed. See [Connections & Channels](./connections.md) |
| `CodeHost` | External platform | Where the repositories live, which of them Notation Factory serves (`allow`), and the credentials containers push with; an infra has one |
| `Account` | Every outpost that runs its runtime | Credentials for an agent runtime, e.g. `CLAUDE_CODE_OAUTH_TOKEN` |
| `OperatorAuth` | Your machine | Who may run the CLI against the running hub. See [Operator auth](./secrets.md#operator-auth) |

Each resource carries the package it came from and its version. `factory infra up` gives the router and deployer the packages they load, and every outpost container the connections', policies' and runtimes', and each installs them from npm when it starts. Upgrading a plugin in the infrastructure repository and running `factory infra up` redeploys what loads it. A container that lists a runtime no infra `Account` covers fails its deploy. To add a platform or provider of your own, see [Writing Plugins](./plugins.md).

## Deploying & updating

Reconcile your live cloud resources and subscribed outposts with `factory.infra.ts`:

```sh
factory infra up --dry-run   # preview diff without modifying resources
factory infra up             # apply infra changes and sync subscribed outposts
factory infra up --prune     # delete sleeping containers for unsubscribed repos
```

| Outpost state | Default (`factory infra up`) | With `--prune` |
| --- | --- | --- |
| **Subscribed** | Built and routed | Built and routed |
| **Unsubscribed or removed** | Unrouted; container + `/data` kept asleep | Container + `/data` permanently deleted |

## Multiple connections

Connect several GitHub organizations, personal accounts or platforms to the same hub:

```ts [factory.infra.ts]
export default factory(() => {
  // …
  const org = new github.Connection("org", { name: "acme-agents", org: "acme", router });

  new github.Connection("personal", {
    name: "alice-agents", // <-- omit `org` for a personal GitHub App
    router,
  });

  new slack.Connection("slack", { name: "acme-agents", workspace: "acme", router });
});
```

All connections deliver events through the shared `Router`. Only one of them backs the `CodeHost`; the others are channels only. See [Connections & Channels](./connections.md).

## Tearing down

Decommission the hub and all of its outposts:

```sh
factory infra down --dry-run
factory infra down
```

Destroys all outpost containers first, then tears down `Deployer` and `Router`, and opens browser settings for protected resources (GitHub Apps and Slack apps). The `Vault` is protected too, so a hub re-created in the same account finds its keys.
