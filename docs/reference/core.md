# `@notation/factory`

`@notation/factory` holds what both the infrastructure config (`factory.infra.ts`) and repository outpost configs (`.factory/config.ts`) declare, and the contracts every plugin implements.

```bash
@pm.dev("@notation/factory")
```

| Used in | Exports |
| --- | --- |
| `.factory/config.ts` | `Container`, `Policy`, `Trigger` |
| `factory.infra.ts` | `RandomKey` |
| Plugins | The contracts (`Vault`, `Router`, `Connection`, …), `OutpostGroup`, `channelConfig`, `single`, `bindingName` |

Plugins add the vendor-specific resources alongside it. Each has one entrypoint, used in both config files:

| Package | In `factory.infra.ts` | In `.factory/config.ts` |
| --- | --- | --- |
| [`@notation/factory-github`](./github.md) | `Connection`, `CodeHost`, `OperatorAuth` | `Connection.get`, `Policy`, selectors, author sets |
| [`@notation/factory-slack`](./slack.md) | `Connection` | `Connection.get`, selectors, author sets |
| [`@notation/factory-claude`](./claude.md) | `Account` | `Agent`, `runtime` |
| [`@notation/factory-cloudflare`](./cloudflare.md) | `Vault`, `Router`, `Deployer`, `OperatorAuth` | |
| [`@notation/factory-railway`](./railway.md) | `Vault`, `Router`, `Deployer` | |

## Outpost primitives (`.factory/config.ts`)

### `outpost`

Declare a repo's outpost:

```ts [.factory/config.ts]
import { Container, Trigger } from "@notation/factory";

// channels, containers, policies, agents and triggers
```

The deployer runs Notation on `.factory/config.ts` for one repo at a time. Each channel, container, policy, agent and trigger in the file adds its entry to that repo's outpost config. The first one declared creates the outpost's `Outpost` group. Declaring one outside a Notation evaluation throws. The outpost config doesn't contain the repo's name: the deployer stores the config under the repo, and the hub fills in the repo where a GitHub channel has no `scope` or a GitHub policy has no `repo`. The outpost's graph is separate from the infra's. It finds the infra's connections by name, with `Connection.get(name)`.

The deployer evaluates the config in an isolate with no network access and no bindings. The config can import `@notation/factory`, `@notation/factory-github`, `@notation/factory-slack` and `@notation/factory-claude`, and other `.ts` and `.js` files in `.factory/` by relative path. It gets each package's outpost exports, from the table above. An infra-only export, such as `RandomKey` or `new github.Connection(...)`, isn't there. A plugin whose package has infra-only code that the isolate can't load gives its outpost exports a `factory-outpost` export condition.

### `Container` & `Policy`

Define an outpost machine alongside its runtimes, credentials and startup files:

```ts [.factory/config.ts]
const customPolicy = new Policy("custom", { provider: "acme-auth", scopes: ["read"] });

const dev = new Container("dev", {
  image: "./Dockerfile",
  runtimes: [claude.runtime],
  policies: [customPolicy],
  files: {
    "~/.npmrc": "./npmrc",                  // <-- string: copied from .factory/npmrc
    "~/.config/app.json": { region: "eu" }, // <-- object: serialized as JSON
  },
  sleepAfter: "10m",                        // <-- the default
});
```

`Container` declares a scale-to-zero container image alongside the runtimes it installs, its credential policies (`github.Policy` or a custom `Policy`) and startup files. The container stops once it has had no run in progress for `sleepAfter`, which is a number of seconds, minutes or hours, such as `"30s"` or `"1h"`. A container that lists a runtime twice throws.

`Policy` is for credentials a plugin mints: `provider` names the plugin, and `scopes` defaults to `[]`. A code host's own policy, such as `github.Policy`, comes from its plugin.

### `Agent` & `Trigger`

Run an agent when a channel event matches:

```ts [.factory/config.ts]
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

TypeScript infers `E` from `event`, then types the worktree function's parameter from it. The deployer calls the function with the real event, in the isolate that evaluates the config. The runner checks out a persistent git worktree on the branch it returns, cut from `base` if it doesn't exist yet. See [Worktrees & Sessions](../manual/worktrees.md).

A trigger throws when it's declared if its container doesn't list its agent's runtime, or if it sets `base` without `worktree`.

## Hub primitives (`factory.infra.ts`)

Declare the central hub graph:

```ts [factory.infra.ts]
import * as claude from "@notation/factory-claude";
import * as cloudflare from "@notation/factory-cloudflare";
import * as github from "@notation/factory-github";
import { sources } from "@notation/std/resources";

const vault = new cloudflare.Vault("vault");
const router = new cloudflare.Router("router", {
  project: "acme-agents",
  vault,
});
const gh = new github.Connection("gh", { name: "acme-agents", org: "acme", router });
new github.CodeHost("github", { connection: gh, allow: [{ owner: "acme" }] });
new github.OperatorAuth("operators", { connection: gh, logins: ["alice"] });
const claudeToken = new sources.Env("claude-oauth-token", {
  config: { key: "CLAUDE_CODE_OAUTH_TOKEN", track: "scrypt" },
});
const claudeAccount = new claude.Account("claude", {
  auth: vault.secret({ id: "claude-oauth-token", value: claudeToken.credentials.value }),
});
new cloudflare.Deployer("deployer", { router, vault, accounts: [claudeAccount] });
```

| Export | Role |
| --- | --- |
| `RandomKey` | A resource whose credential `Value` is `Bytes` random bytes in hex, such as the root key. Deploy makes the value when it creates the key, and never records it. When a resource that takes the value needs it again and deploy holds none, deploy rotates the key and writes every resource that takes it |
| `scopedName(name, maxLength)` | Makes `<app>--<stage>--<name>` for a resource that Notation doesn't name itself, such as a KV namespace's title. A name longer than `maxLength` is cut, and ends in a hash |
| `bindingName(id)` | Makes a binding name from a secret's id: upper case, with each character other than a letter, a digit or `_` replaced by `_`, and `_` in front if it starts with a digit. For example, `gh-private-key` becomes `GH_PRIVATE_KEY`. `router.bind(secret)` uses it when it is given no name |

`vault.secret({ id, value })` declares a secret in the hub's vault. `value` is a Notation credential: the value of a source, such as `sources.Env` from `@notation/std/resources`, or a key that another resource issues, such as a GitHub App's private key. The provider holds the value, and the vault never reads it back. See [Secrets](../manual/secrets.md#credentials).

## Contracts

Each plugin implements some of these, so that one provider can be swapped for another. A contract is an interface: the fields and methods every provider's version has, so other resources can rely on them whichever provider built it.

```ts
type VaultSecretOptions = {
  id: string;    // keys the secret in state
  value: string; // a credential, such as `source.credentials.value`
};

// A secret that a vault declares. On Cloudflare, a CloudflareSecret.
type VaultSecret = ResourceGroup;

// The hub's write-only secret store. secret() only declares a secret. The
// router or the deployer binds it where it is used.
interface Vault<S extends VaultSecret = VaultSecret> {
  provider: string;
  secret(opts: VaultSecretOptions): S;
}

// Receives every connection's deliveries, matches triggers, relays channel
// replies and mints code host tokens. `url` is the router's URL, an output
// ref. `store` is where its config is contributed to, such as a `kvJson()`
// document. `rootKey` is the secret every other key is derived from. bind()
// binds a secret from `vault` to the router, and returns its binding name,
// made from the secret's id unless `name` is given. channel() runs a
// connection's channel.
interface Router {
  url: OutputRef<string>;
  store: RouterConfigStore;
  vault: Vault;
  rootKey: VaultSecret;
  bind(secret: VaultSecret, name?: string): string;
  channel(options: RouterChannelOptions): void;
}

// A connection's channel: the module that exports it, and the secrets and
// values it reads by name.
type RouterChannelOptions = {
  connection: string; // such as "github/acme-agents"
  module: string; // absolute path of a module that exports `channel`
  secrets?: Record<string, VaultSecret>;
  values?: Record<string, Input<string>>;
};

// In the infra: Notation Factory's presence on a platform.
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

// Credentials an agent runtime runs on, keyed by the env var containers read
// them as. The deployer binds each under that name.
interface Account {
  runtime: Runtime;
  secrets: Record<string, VaultSecret>;
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
| The router's | `router.store` (Cloudflare: a `kvJson()` document in KV, checked against a schema at plan; Railway: a file on the router's volume) | Each `Connection` (`connections`), the `CodeHost` (`codeHost`) and the `OperatorAuth` (`operators`) |
| An outpost's | One entry per repo, which the deployer applies | Its channels, containers, policies, agents and triggers, keyed by id |

An infra has one code host and one operator auth. A second one is a conflict that names both.
