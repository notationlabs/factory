# `lightbox`

`lightbox` holds what both the infrastructure config (`lightbox.infra.ts`) and repository outpost configs (`.lightbox/config.ts`) declare, and the contracts every plugin implements.

```bash
@pm.dev("lightbox")
```

| Used in | Exports |
| --- | --- |
| `.lightbox/config.ts` | `outpost`, `Container`, `Policy`, `Trigger` |
| `lightbox.infra.ts` | `lightbox`, `secret` |
| Plugins | The contracts (`Vault`, `Router`, `Connection`, …), `OutpostGroup`, `channelConfig`, `single`, `isSecret` |

Plugins add the vendor-specific resources alongside it. Each has one entrypoint, used in both config files:

| Package | In `lightbox.infra.ts` | In `.lightbox/config.ts` |
| --- | --- | --- |
| [`@lightbox/github`](./github.md) | `Connection`, `CodeHost`, `OperatorAuth` | `Connection.get`, `Policy`, selectors, author sets |
| [`@lightbox/slack`](./slack.md) | `Connection` | `Connection.get`, selectors, author sets |
| [`@lightbox/claude`](./claude.md) | `Account` | `Agent`, `runtime` |
| [`@lightbox/cloudflare`](./cloudflare.md) | `Vault`, `Router`, `Deployer`, `OperatorAuth` | |
| [`@lightbox/railway`](./railway.md) | `Vault`, `Router`, `Deployer` | |

## Outpost primitives (`.lightbox/config.ts`)

### `outpost`

Declare a repo's outpost:

```ts [.lightbox/config.ts]
import { Container, outpost, Trigger } from "lightbox";

export default outpost(() => {
  // channels, containers, policies, agents and triggers
});
```

`outpost(declare)` returns a function the deployer calls with the repo it's deploying. Channels, containers, policies, agents and triggers must be declared inside `declare`: each adds its entry to that repo's outpost config, and throws if there's no outpost. The outpost's graph is separate from the infra's. It finds the infra's connections by name, with `Connection.get(name)`.

### `Container` & `Policy`

Define an outpost machine alongside its runtimes, credentials and startup files:

```ts [.lightbox/config.ts]
const customPolicy = new Policy("custom", { provider: "acme-auth", scopes: ["read"] });

const dev = new Container("dev", {
  image: "./Dockerfile",
  runtimes: [claude.runtime],
  policies: [customPolicy],
  files: {
    "~/.npmrc": "./npmrc",                  // <-- string: copied from .lightbox/npmrc
    "~/.config/app.json": { region: "eu" }, // <-- object: serialized as JSON
  },
});
```

`Container` declares a scale-to-zero container image alongside the runtimes it installs, its credential policies (`github.Policy` or a custom `Policy`) and startup files. A container that lists a runtime twice throws.

`Policy` is for credentials a plugin mints: `provider` names the plugin, and `scopes` defaults to `[]`. A code host's own policy, such as `github.Policy`, comes from its plugin.

### `Agent` & `Trigger`

Run an agent when a channel event matches:

```ts [.lightbox/config.ts]
const coder = new claude.Agent("coder", { model: "claude-opus-5-5" });

new Trigger("mention", {
  event: gh.issueComment({ mention: "@claude", from: github.collaborators() }), // <-- any channel Selector
  worktree: (event) => `issue-${event.issue.number}`,                           // <-- optional
  base: "main",                                                                  // <-- optional, only with `worktree`
  agent: coder,
  container: dev,
});
```

```ts
class Trigger<E> {
  constructor(
    id: string,
    options: {
      event: Selector<E>;
      worktree?: (event: E) => string | undefined;
      base?: string;
      agent: Agent;
      container: Container;
    },
  );
}
```

TypeScript infers `E` from `event`, then types the worktree function's parameter from it. The runner calls the function with the real event, and checks out a persistent git worktree on the branch it returns, cut from `base` if it doesn't exist yet. See [Worktrees & Sessions](../manual/worktrees.md).

A trigger throws when it's declared if its container doesn't list its agent's runtime, or if it sets `base` without `worktree`.

## Hub primitives (`lightbox.infra.ts`)

Declare the central hub graph:

```ts [lightbox.infra.ts]
import { lightbox, secret } from "lightbox";
import * as claude from "@lightbox/claude";
import * as cloudflare from "@lightbox/cloudflare";
import * as github from "@lightbox/github";

export default lightbox(() => {
  const vault = new cloudflare.Vault("vault");
  const router = new cloudflare.Router("router", { project: "acme-agents", vault });
  const gh = new github.Connection("gh", { name: "acme-agents", org: "acme", router });
  new github.CodeHost("github", { connection: gh, allow: [{ owner: "acme" }] });
  new github.OperatorAuth("operators", { connection: gh, logins: ["alice"] });
  const claudeAccount = new claude.Account("claude", { auth: secret.env("CLAUDE_CODE_OAUTH_TOKEN") });
  new cloudflare.Deployer("deployer", { router, vault, accounts: [claudeAccount] });
});
```

| Export | Role |
| --- | --- |
| `lightbox(declare)` | Captures the resource graph for `lightbox infra up` and `lightbox infra down` |
| `secret.env(name)` | A secret read from your environment by `lightbox infra up` and written to the vault, e.g. `CLAUDE_CODE_OAUTH_TOKEN` |
| `secret.generated(bytes?)` | A random secret generated once when its vault item is created, e.g. the root key. 32 bytes by default |
| `secret.prompt(label)` | A secret pasted, unechoed, by whoever runs the deploy, e.g. a Slack bot token |
| `secret.output(value)` | Another resource's output, e.g. a GitHub App's private key |

A secret says where a vault item's value comes from. It's part of the item's identity, not its value: the provider holds the value, and the vault never reads it back.

## Contracts

Each plugin implements some of these, so that one provider can be swapped for another. A contract is an interface: the fields and methods every provider's version has, so other resources can rely on them whichever provider built it.

```ts
// The hub's write-only secret store. secret() adds an item the vault owns.
interface Vault {
  provider: string;
  secret(opts: { id: string; name: string; value: Secret }): Resource;
}

// Receives every connection's deliveries, matches triggers, relays channel
// replies and mints code host tokens. `api` has the router's `url`; `store`
// is where its config is contributed to.
interface Router {
  api: RouterApi;
  store: RouterConfigStore;
  vault: Vault;
}

// In the infra: lightbox's presence on a platform.
interface Connection {
  name: string;
  router: Router;
}

// In an outpost: a connection the infra declares, found by name.
interface ConnectionRef {
  name: string;
  channel(opts: { id: string; scope?: string }): Channel;
}

interface Channel {
  scope: string;
  connection: ConnectionRef;
}

// Where the repos live, and which of them get outposts. An infra has one.
interface CodeHost {
  connection: Connection;
  allow: RepoPattern[];
}

// Who may run the CLI against the running hub.
interface OperatorAuth {
  provider: string;
}

// Credentials an agent runtime runs on, by env var.
interface Account {
  runtime: Runtime["id"];
  secrets: Record<string, Secret>;
}

interface Deployer {
  router: Router;
  vault: Vault;
  accounts: Account[];
}

interface Runtime {
  id: string;    // e.g. "claude"
  setup: string; // a directory holding setup.sh, run at image build
}

interface Agent {
  runtime: Runtime;
}

// Credentials a container may ask the router for. `provider` names what mints them.
interface PolicyContract {
  provider: string;
}
```

Selectors (labels, mentions, comment actions, `from`) are each platform's own vocabulary. A channel builds them as typed `Selector<E>` values, and the router matches them as data, without running any of the repo's code.

The contracts don't hand each other their config. They contribute to two configs instead:

| Config | Kept in | Contributed by |
| --- | --- | --- |
| The router's | `router.store` (Cloudflare: a KV entry; Railway: a file on the router's volume) | Each `Connection` (`connections`), the `CodeHost` (`codeHost`) and the `OperatorAuth` (`operators`) |
| An outpost's | One entry per repo, which the deployer applies | Its channels, containers, policies, agents and triggers, keyed by id |

An infra has one code host and one operator auth. A second one is a conflict that names both.
