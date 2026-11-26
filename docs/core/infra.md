# Declaring Infra

Declare your organization's shared Notation Factory hub in `factory.infra.ts` alongside `notation.config.ts` and `factory.config.ts`. One hub serves every allowed repository outpost in your organization.

## Hub components

A hub declares its vault, router, GitHub connection, code host, operator access list, agent accounts, and deployer:

```ts [factory.infra.ts]
import * as claude from "@notation/factory-claude";
import * as cloudflare from "@notation/factory-cloudflare";
import * as github from "@notation/factory-github";
import { sources } from "@notation/std/resources";

const vault = new cloudflare.Vault("vault");
const router = new cloudflare.Router("router", { vault });

const gh = new github.Connection("gh", { org: "acme", router });

new github.CodeHost("github", {
  connection: gh,
  allow: [{ owner: "acme" }],
});

new github.OperatorAuth("operators", {
  connection: gh,
  users: ["alice"],
});

const claudeToken = new sources.Env("claude-oauth-token", {
  config: { key: "CLAUDE_CODE_OAUTH_TOKEN", track: "scrypt" },
});
const claudeAccount = new claude.Account("claude", {
  auth: vault.secret({
    id: "claude-oauth-token",
    value: claudeToken.credentials.value,
  }),
});

new cloudflare.Deployer("deployer", {
  router,
  vault,
  accounts: [claudeAccount],
  regions: ["WEUR"],
});
```

Each component has a distinct responsibility in the hub:

| Component | Role |
| :--- | :--- |
| `Vault` | Stores secrets in Cloudflare Secrets Store and binds them selectively |
| `Router` | Receives webhook deliveries, matches outpost triggers, and relays replies |
| `Deployer` | Evaluates outpost configs, builds container images, and starts agent runs |
| `Connection` | Registers a GitHub App webhook feed and bot identity with the router |
| `CodeHost` | Defines allowed repositories and mints scoped installation tokens for runs |
| `Account` | Supplies runtime credentials injected into containers listing that runtime |
| `OperatorAuth` | Lists GitHub logins or numeric user IDs permitted to run admin commands |

Each repository then declares its own triggers, containers, policies, and agents in `.factory/infra.ts`. See [Declaring Outposts](./outposts.md).

Every runtime used in an outpost needs a matching `Account` on the deployer so containers receive its credentials and, when using the default image, its setup script. To add support for another provider, channel, or runtime, see [Plugin Overview](../authoring/plugins.md).

## Hub configuration files

Alongside `factory.infra.ts`, the hub repository uses `notation.config.ts` for deployment metadata and `factory.config.ts` for CLI settings:

::code-group

```ts [notation.config.ts]
import { defineConfig } from "@notation/core/config";

export default defineConfig({
  app: "acme-factory",
  entry: "factory.infra.ts",
  defaultStage: "prod",
});
```

```ts [factory.config.ts]
export default {
  router: "https://your-router-url.workers.dev",
  loadEnv: "op run --env-file .env --",
};
```

::

`factory.config.ts` is optional and accepts two fields:

| Field | Purpose |
| :--- | :--- |
| `router` | Hub router URL called by `factory infra status` and `factory infra replay` |
| `loadEnv` | Command prefix executed before `notation` during `up` and `down` |

`factory infra up` prints the router URL on first deploy and whenever the URL changes.

## Deployer options and outpost secrets

`cloudflare.Deployer` accepts placement, idle timeout, and repository-scoped secret options alongside `router`, `vault`, and `accounts`:

| Option | Behavior |
| :--- | :--- |
| `accountId` | Cloudflare account for outpost Workers; defaults to `CLOUDFLARE_ACCOUNT_ID` |
| `regions` | Allowed Cloudflare container regions such as `["WEUR"]` |
| `sleepAfter` | Idle duration before sleeping containers; defaults to `"10m"` |
| `maxInstances` | Maximum number of awake instances of each container; defaults to `5` |
| `secrets` | Array of `OutpostSecret` entries scoped to matching repositories |

Use `OutpostSecret` from `@notation/factory` to pass repository-specific environment variables through the vault without sharing them across other outposts. See [Secrets](./secrets.md) and [Cloudflare Provider](./cloudflare.md).

## Multiple connections and accounts

Declare multiple `github.Connection` resources to connect separate organizations or personal accounts, and pass multiple `Account` resources to support Claude Code, Cursor Agent, and Droid in the same hub:

```ts [factory.infra.ts]
const orgGh = new github.Connection("acme-gh", { org: "acme", router });
const personalGh = new github.Connection("personal-gh", { router });

new github.CodeHost("github", {
  connection: orgGh,
  allow: [{ owner: "acme" }],
});
```

Omitting `org` creates a GitHub App under your personal GitHub account instead of an organization. A hub may have multiple connections, but only one connection backs `CodeHost`.

## Deploying, inspecting, and tearing down

Reconcile the hub with `factory infra up`, inspect repository deploys and failed deliveries with `factory infra status`, or tear down the hub with `factory infra down`:

```bash [Terminal]
factory infra up --dry-run
factory infra up
factory infra up --credential <id>.<credential>@<hash>=<var>
factory infra status
factory infra replay
factory infra down
```

Every `factory infra up` triggers the router to redeploy all allowed, installed repositories from their default branches and remove unallowed outpost configs. See [CLI Guide](./cli.md) for all command flags.

`factory infra down` deletes outpost Workers matching the deployer prefix first, then tears down the deployer, router, Artifacts namespace, and vault secrets. Because GitHub Apps and Cloudflare user builds tokens cannot be deleted via API, Factory opens or prints their settings URLs for manual removal.
