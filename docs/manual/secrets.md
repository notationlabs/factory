# Secrets

Keep every secret the hub holds in one vault that only the hub can read:

```ts [factory.infra.ts]
import * as claude from "@notation/factory-claude";
import * as cloudflare from "@notation/factory-cloudflare";
import * as github from "@notation/factory-github";
import { env } from "@notation/std/sources";

const vault = new cloudflare.Vault("vault"); // <-- 1. where the hub's secrets live

const router = new cloudflare.Router("router", {
  project: "acme-agents",
  vault,
});

const gh = new github.Connection("gh", { name: "acme-agents", org: "acme", router });
new github.CodeHost("github", { connection: gh, allow: [{ owner: "acme" }] });

new github.OperatorAuth("operators", { connection: gh, logins: ["djgrant", "alice"] }); // <-- 2. who may run the CLI against the hub

const claudeAccount = new claude.Account("claude", {
  auth: vault.secret({ id: "claude-oauth-token", source: env, key: "CLAUDE_CODE_OAUTH_TOKEN" }), // <-- 3. read from your environment at deploy
});

new cloudflare.Deployer("deployer", { router, vault, accounts: [claudeAccount] });
```

A Notation Factory instance has secrets in three places: your machine, the hub (`Router` and `Deployer`), and each outpost container. This page explains what each place holds, how each secret gets there, and who can read it.

## Where secrets live

| Place | Holds | Who reads it |
| --- | --- | --- |
| **Local** | Your container provider sign-in, your `gh` login, account secrets such as `CLAUDE_CODE_OAUTH_TOKEN` | `factory` on your machine |
| **Hub vault** | `FACTORY_ROOT_KEY`, each connection's credentials (GitHub App private keys, Slack bot tokens and signing secrets), account secrets | The `Router`, the `Deployer`, or both, depending on the secret. See [Who binds each secret](#who-binds-each-secret) |
| **Outpost** | Its `FACTORY_CONTAINER_KEY`, the secrets of the accounts whose runtimes it lists, short-lived code host tokens the router mints | That container; agents get only the minted tokens and account secrets |

**The hub vault is write-only from outside the hub.** `factory infra up` writes a secret's value to the vault's store, and never reads one back. Holding the container provider's credentials lets you replace the hub's secrets, not read them.

## The root key

`FACTORY_ROOT_KEY` is a random key. The router declares it with the `generated()` source from `@notation/factory`, so `factory infra up` generates it when it creates the secret, writes it to the vault, and then forgets it. Every other secret Notation Factory makes is derived from it with HMAC, so the hub stores one key instead of many:

```text
FACTORY_ROOT_KEY
 ├─ container key   HMAC(root, repo + container)               container ⇄ router, both directions
 ├─ webhook secret  HMAC(root, "github:webhook:" + App id)     GitHub ─▶ router
 ├─ admin key       HMAC(root, "admin")                        router ⇄ deployer
 └─ internal key    HMAC(root, "cloudflare:…")                 Cloudflare Workers' private routing (*.factory.internal)
```

Neither the router nor the deployer stores a derived key. Each derives the key where the root key is bound, when it needs it. For example, the router derives `acme-agents`' webhook secret to verify a webhook, and derives a container's key to verify that container's request for credentials.

The deployer gives each container its own `FACTORY_CONTAINER_KEY` when it deploys the container. A container can only sign as itself, so it can't impersonate another container.

Platforms that issue their own signing secret, such as Slack, keep it in the vault as part of the connection's credentials instead of deriving one.

## The hub vault

The vault is a `Vault` from the hub's provider plugin. `vault.secret(...)` declares a secret in it, in the same way as Notation's `secret()`. Declaring a secret doesn't give anything access to it. The router or the deployer binds the secret to its own Worker or service, under a name it chooses. For example, `github.Connection` declares its App's private key and binds it to the router:

```ts
const privateKey = router.bind(                  // <-- returns the binding name, here GH_PRIVATE_KEY
  router.vault.secret({ id: "gh-private-key" }), // <-- the secret's id in state; `notation secret set` takes it
);
```

`vault.secret(...)` takes these fields:

| Field | Meaning |
| --- | --- |
| `id` | Keys the secret in Notation's state. `notation secret set <id>` takes it |
| `source`, `key` | Where the value comes from, such as `{ source: env, key: "CLAUDE_CODE_OAUTH_TOKEN" }`. Optional |

On Cloudflare, `vault.secret(...)` returns Notation's `SecretGroup`.

`router.bind(secret, name?)` binds the secret to the router's Worker or service, and returns the binding name. Without `name`, the binding name is made from the secret's id with `bindingName(id)` from `@notation/factory`. `bindingName` makes the id upper case, and replaces each character other than a letter, a digit or `_` with `_`. If the result starts with a digit, it adds `_` in front. For example, `gh-private-key` becomes `GH_PRIVATE_KEY`. A connection records the binding names in its entry in the router's config.

The factory doesn't choose the secret's name in the store. The vault's provider makes a name scoped to the Notation app and stage, so two stages of one hub keep separate secrets:

| Provider | `Vault` | Each secret is | Name in the store |
| --- | --- | --- | --- |
| Cloudflare | `cloudflare.Vault` | A secret in the account's Secrets Store. Values can't be read back through the API. Workers read it through a `secrets_store_secret` binding | `<app>--<stage>--<id>` |
| Railway | `railway.Vault` | A sealed shared variable in the router's project. Values are never shown in the dashboard or returned by the API. A service reads it through a variable named after the binding name, whose value is `${{shared.<name>}}` | `<app>__<stage>__<id>`, with characters other than letters, digits and `_` replaced by `_` |

**The vault and the hub are always on the same provider.** `cloudflare.Router` and `cloudflare.Deployer` take only a `cloudflare.Vault`. A vault elsewhere would need its own access credential, and that credential would have to live in the hub provider's store anyway.

### Where a value comes from

A secret follows Notation's secret model. It takes its value from a source and a key, or, with no source, from you:

| Secret declared with | `factory infra up` |
| --- | --- |
| `{ source: env, key: "CLAUDE_CODE_OAUTH_TOKEN" }` | Reads `CLAUDE_CODE_OAUTH_TOKEN` from the environment it runs in, and writes it on every deploy |
| `{ source: dotenv(".env.local"), key: "CLAUDE_CODE_OAUTH_TOKEN" }` | Reads the key from that `.env` file, and writes it on every deploy |
| `{ source: generated(), key: "FACTORY_ROOT_KEY" }` | Generates a random value once, when it creates the secret |
| No source | Asks for the value with a hidden prompt when it creates the secret, on a terminal. Without a terminal, the deploy fails |

`env` and `dotenv` come from `@notation/std/sources`. Notation records each secret's source, key and version, and never the value or anything derived from it. See Notation's [Secrets](https://github.com/notationlabs/notation/blob/main/docs/manual/secrets.md) page for the sources, when each one writes, and how to write your own.

To set a secret that has no source, for example before a deploy in CI, run `notation secret set` with its id. It reads the value from a hidden prompt, or from stdin:

```sh
notation secret set gh-private-key --stage prod < acme-agents.private-key.pem
```

See [notation secret](https://github.com/notationlabs/notation/blob/main/docs/cli/secret.md).

### The secrets in the vault

For the example at the top of this page, the vault holds these secrets:

| Secret `id` | Binding name | Declared by | Bound by | Value from |
| --- | --- | --- | --- | --- |
| `router-root-key` | `FACTORY_ROOT_KEY` | `Router`, as `router.rootKey` | Router and deployer | `generated()` |
| `gh-private-key` | `GH_PRIVATE_KEY` | `github.Connection` | Router | No source: set it with `notation secret set` |
| `slack-bot-token`, `slack-signing-secret` | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | `slack.Connection`, if the hub has one | Router | No source: deploy asks for them, or set them with `notation secret set` |
| `claude-oauth-token` | `CLAUDE_CODE_OAUTH_TOKEN` | You, in the account's `auth` | Deployer | `env` |

A connection's secret ids start with the connection's id, and the router makes each binding name from the id. So several connections of one provider each get their own bindings. For example, connections with the ids `gh` and `personal` bind `GH_PRIVATE_KEY` and `PERSONAL_PRIVATE_KEY`.

The deployer binds an account's secrets under the env var names that the account gives them, such as `CLAUDE_CODE_OAUTH_TOKEN`. The secret's id is yours to choose.

The GitHub App's private key has to be set by hand for now. Generate a private key on the App's settings page, then run `notation secret set gh-private-key`. Later, the App's create will write the key, once Notation supports a resource writing a secret value. See [Known gaps](./providers.md#known-gaps).

### Who binds each secret

Each Worker or service binds only the secrets it uses:

| Secret | Router | Deployer |
| --- | --- | --- |
| `FACTORY_ROOT_KEY` | Bound by the router | Bound by the deployer |
| Connection credentials | Bound by each connection, with `router.bind(...)` | Not bound |
| Account secrets | Not bound | Bound by the deployer, for each of its `accounts` |

**The router never binds an account's secrets, and the deployer never binds a connection's credentials.** A leak of one Worker or service therefore exposes only the secrets it binds, plus the root key.

On Cloudflare, a binding is a `secrets_store_secret` entry in the Worker's `Bindings`. On Railway, it is a variable on the service.

### The deployer's provider token

The deployer's own provider token isn't a vault secret. It's a resource the deployer owns:

| Provider | Token | How the deployer gets it |
| --- | --- | --- |
| Cloudflare | An account API token, with Workers Scripts Write, Workers CI Write and Workers Containers Write in the deployer's account | Cloudflare returns its value only when it creates the token. Notation writes the value to a Secrets Store secret, and the deployer Worker binds it as `CLOUDFLARE_API_TOKEN` |
| Railway | A project token | `factory infra up` creates it with your sign-in. The deployer service doesn't receive its value yet. See [Known gaps](./providers.md#known-gaps) |

`notation secret set` can't set the Cloudflare token, because only the token's create can write its value.

### Losing the vault

The vault's secrets belong to the hub's Notation stage, so `factory infra down` deletes them along with the router and deployer. When you bring the hub up again, or move it to another provider:

- `factory infra up` generates a new root key, and the router re-derives every webhook secret and container key.
- The GitHub Apps survive, but their private keys don't. Generate a new private key on each App's page, and set it with `notation secret set`.
- For a Slack app, enter its bot token and signing secret again.
- Account secrets with a source are written again from the source.

## Local credentials

`factory infra up` and `factory infra down` create, update and delete the hub, so they authenticate with your own credentials:

| Step | Credential |
| --- | --- |
| Create and deploy the hub on Cloudflare | `npx wrangler login`, or `CLOUDFLARE_API_TOKEN` (e.g. in CI). Creating the deployer's token needs the Account API Tokens: Edit permission |
| Choose the deployer's Cloudflare account | `CLOUDFLARE_ACCOUNT_ID`, or `accountId` on `cloudflare.Deployer` |
| Create and deploy the hub on Railway | `RAILWAY_API_TOKEN` |
| Create a GitHub App or Slack app | Your browser, through the platform's manifest flow |
| Calls to GitHub as you, e.g. `factory repo install` | Your `gh` login |
| Write account secrets to the vault | The account's source, e.g. `CLAUDE_CODE_OAUTH_TOKEN` in your environment for `env` |

The `infra` commands check each one before they start, and their messages name the credential that's missing or refused.

You can load them at startup with `loadEnv` in `factory.config.ts`, beside `factory.infra.ts`:

```ts [factory.config.ts]
export default {
  loadEnv: "./with-env.sh", // <-- every factory command adopts the environment this sets
};
```

`loadEnv` is a command prefix: `./with-env.sh` stands for any command that sets variables and then runs the command after it, such as your secret manager's CLI. `factory` runs it once when it starts and takes on the environment it sets, so your terminal stays attached.

## Operator auth

Commands that talk to a running hub sign you in as an operator instead of using the root key: `factory infra status`, `factory infra replay`, the sync at the end of `factory infra up`, and the router calls `factory infra down` makes. The router checks who you are and returns a short-lived admin session. `factory infra status` and `factory infra replay` need no provider credentials at all.

**Operators are not the code host's `allow` list.** `allow` on `CodeHost` decides whose repos get outposts. Operators are the people allowed to run the CLI against the hub.

Each `OperatorAuth` decides who you are differently:

| `OperatorAuth` | You sign in with | Who decides access |
| --- | --- | --- |
| `github.OperatorAuth` | GitHub, through the connection's App | The router, against `logins` |
| `cloudflare.OperatorAuth` | Cloudflare Access, in your browser | Cloudflare Access, against `emails`; the router verifies Access's token |

To use Cloudflare Access instead of GitHub:

```ts [factory.infra.ts]
// …
new cloudflare.OperatorAuth("operators", { router, emails: ["dj@acme.dev", "alice@acme.dev"] });
```

Platform operations that need a connection's credentials run in the router, which has them: for GitHub, reading the App's settings, and reading and setting its webhook. `factory infra up` asks the router to do them.

## Short-lived tokens

The router turns the code host's App private key into short-lived GitHub installation tokens, so nothing outside the hub holds a long-lived GitHub credential:

| Token for | Asked for by | Used to |
| --- | --- | --- |
| A container's policies | The container, signing with `FACTORY_CONTAINER_KEY` | Push branches, open PRs, and whatever else its `Policy` grants. The container installs them in files only its own user can read, and agents use them |
| The deployer | The deployer, signing with the admin key | Read `.factory/` from a repo, and write `FACTORY_STATUS` |

A container refreshes its tokens when fewer than 30 minutes remain. A code host that can't mint tokens limited to one repo and short-lived fails the deploy of any repo whose policies need them.

Containers get no channel credential. They read and reply on a conversation through the router's [channel relay](./connections.md#channel-relay), signing with `FACTORY_CONTAINER_KEY`.

## Outposts

Outposts declare no secrets of their own. The deployer gives each container two things when it deploys it, stored as the provider's own secrets (Worker secrets on Cloudflare, sealed variables on Railway):

- its `FACTORY_CONTAINER_KEY`
- the secrets of every account whose runtime the container lists, which the deployer reads through its own bindings

A container that lists only `claude.runtime` gets the Claude account's token and nothing else.

Agents never see `FACTORY_CONTAINER_KEY` or any provider's private variables. They see the minted tokens and the account secrets.

## Topology

Taken together, secrets flow one way, from your machine into the vault and from the vault out to services and containers:

```text
 LOCAL                               HUB                                        OUTPOST
 ─────                               ───                                        ───────
 provider sign-in ──infra up──▶ creates and deploys Router, Deployer, Vault
 browser ───────────infra up──▶ creates GitHub App, Slack app
 CLAUDE_CODE_OAUTH_TOKEN ──── from its source ──┐
 App key, Slack values ── prompt or secret set ─┤ written, never read back
                                                ▼
                               ┌─────────────────────────────┐
                               │ Vault                       │
                               │   FACTORY_ROOT_KEY          │
                               │   connection credentials    │
                               │   account secrets           │
                               └──────┬───────────────┬──────┘
                        root key and  │               │ root key and
                        connections   ▼               ▼ accounts
 GitHub, Slack ──events────────▶ Router ◀─admin key─▶ Deployer ──deploys──▶ Container
        (signed)                  ▲   │                                       FACTORY_CONTAINER_KEY
                                  │   │                                       account secrets
 operator sign-in ──session───────┘   ├──minted tokens, on a request ───────▶ token files
                                      │  signed with the container key
                                      └──channel relay ◀──────────────────── replies
```
