# Secrets

Keep every secret the hub holds in one vault that only the hub can read:

```ts [factory.infra.ts]
import { factory, secret } from "@notation/factory";
import * as claude from "@notation/factory-claude";
import * as cloudflare from "@notation/factory-cloudflare";
import * as github from "@notation/factory-github";

export default factory(() => {
  const vault = new cloudflare.Vault("vault"); // <-- 1. where the hub's secrets live

  const router = new cloudflare.Router("router", { project: "acme-agents", vault });

  const gh = new github.Connection("gh", { name: "acme-agents", org: "acme", router });
  new github.CodeHost("github", { connection: gh, allow: [{ owner: "acme" }] });

  new github.OperatorAuth("operators", { connection: gh, logins: ["djgrant", "alice"] }); // <-- 2. who may run the CLI against the hub

  const claudeAccount = new claude.Account("claude", {
    auth: secret.env("CLAUDE_CODE_OAUTH_TOKEN"), // <-- 3. copied from your environment into the vault
  });

  new cloudflare.Deployer("deployer", { router, vault, accounts: [claudeAccount] });
});
```

A Notation Factory instance has secrets in three places: your machine, the hub (`Router` and `Deployer`), and each outpost container. This page explains what each place holds, how each secret gets there, and who can read it.

## Where secrets live

| Place | Holds | Who reads it |
| --- | --- | --- |
| **Local** | Your container provider sign-in, your `gh` login, account secrets such as `CLAUDE_CODE_OAUTH_TOKEN` | `factory` on your machine |
| **Hub vault** | `FACTORY_ROOT_KEY`, each connection's credentials (GitHub App private keys, Slack bot tokens and signing secrets), account secrets | `Router` and `Deployer` only |
| **Outpost** | Its `FACTORY_CONTAINER_KEY`, the secrets of the accounts whose runtimes it lists, short-lived code host tokens the router mints | That container; agents get only the minted tokens and account secrets |

**The hub vault is write-only from outside the hub.** `factory infra up` writes a secret to it when a resource is created or a local value changes, and never reads one back. Holding the container provider's credentials lets you replace the hub's secrets, not read them.

## The root key

`FACTORY_ROOT_KEY` is a random key that `factory infra up` generates the first time it creates the router, writes to the vault, and then forgets. Every other secret Notation Factory makes is derived from it with HMAC, so the hub stores one key instead of many:

```text
FACTORY_ROOT_KEY
 ├─ container key   HMAC(root, repo + container)    container ⇄ router, both directions
 ├─ webhook secret  HMAC(root, App id)              GitHub ─▶ router
 ├─ admin key       HMAC(root, "admin")             router ⇄ deployer
 └─ internal key    HMAC(root, "cloudflare:…")      Cloudflare Workers' private routing (*.factory.internal)
```

Neither the router nor the deployer stores a derived key. Each derives the key where the root key is bound, when it needs it. For example, the router derives `acme-agents`' webhook secret to verify a webhook, and derives a container's key to verify that container's request for credentials.

The deployer gives each container its own `FACTORY_CONTAINER_KEY` when it deploys the container. A container can only sign as itself, so it can't impersonate another container.

Platforms that issue their own signing secret, such as Slack, keep it in the vault as part of the connection's credentials instead of deriving one.

## The hub vault

`Router` and `Deployer` both take the vault. Both read secrets from it through the provider's binding; nothing else does. Each hub provider backs its vault with its own write-only store:

| Provider | `Vault` | Backed by |
| --- | --- | --- |
| Cloudflare | `cloudflare.Vault` | Secrets Store: values can't be read back through the API; Workers read them through a binding |
| Railway | `railway.Vault` | Sealed variables: values are never shown in the dashboard or returned by the API |

**The vault and the hub are always on the same provider.** `cloudflare.Router` and `cloudflare.Deployer` take only a `cloudflare.Vault`. A vault elsewhere would need its own access credential, and that credential would have to live in the hub provider's store anyway.

The vault holds three kinds of secret:

| Secret | Written by | When |
| --- | --- | --- |
| `FACTORY_ROOT_KEY` | `factory infra up` | Once, when it creates the router |
| Connection credentials | `factory infra up` | Once, when it creates the connection: a GitHub App's private key, or the Slack app's bot token and signing secret you paste. One item per connection |
| Account secrets, e.g. `secret.env("CLAUDE_CODE_OAUTH_TOKEN")` | `factory infra up`, from your environment | When the local value changes |

Notation Factory treats secrets differently from variables. A secret is write-only: `factory infra up` plans it by whether it exists or by a fingerprint of the local value, never by reading the value. It keeps the fingerprint, never the value, so it can tell a changed local token from an unchanged one without reading the vault. A generated secret, such as the root key, is written once and never read by the CLI again.

The deployer's own provider token isn't a vault item. It's a resource the deployer owns: a Cloudflare account API token, or a Railway project token. `factory infra up` creates it with your provider sign-in and gives its value to the deployer. Its value is only returned when it's created, and is never shown.

`factory infra down` leaves the vault in place, like the GitHub Apps it can't delete. A hub re-created in the same account finds its root key and connection credentials.

If you lose the vault (for example, by moving to another provider), the root key is generated again and the router re-derives every webhook secret and container key. The GitHub Apps survive, but their private keys don't: generate a new private key on each App's page and `factory infra up` writes it to the new vault. For a Slack app, paste its bot token and signing secret again.

## Local credentials

`factory infra up` and `factory infra down` create, update and delete the hub, so they authenticate with your own credentials:

| Step | Credential |
| --- | --- |
| Create and deploy the hub on Cloudflare | `npx wrangler login`, or `CLOUDFLARE_API_TOKEN` (e.g. in CI) |
| Create and deploy the hub on Railway | `RAILWAY_API_TOKEN` |
| Create a GitHub App or Slack app | Your browser, through the platform's manifest flow |
| Calls to GitHub as you, e.g. `factory repo install` | Your `gh` login |
| Copy account secrets into the vault | e.g. `CLAUDE_CODE_OAUTH_TOKEN` in your environment |

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
export default factory(() => {
  // …
  new cloudflare.OperatorAuth("operators", { router, emails: ["dj@acme.dev", "alice@acme.dev"] });
});
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
- the `env()` of every account whose runtime the container lists, read from the vault

A container that lists only `claude.runtime` gets the Claude account's token and nothing else.

Agents never see `FACTORY_CONTAINER_KEY` or any provider's private variables. They see the minted tokens and the account secrets.

## Topology

Taken together, secrets flow one way, from your machine into the vault and from the vault out to services and containers:

```text
 LOCAL                               HUB                                        OUTPOST
 ─────                               ───                                        ───────
 provider sign-in ──infra up──▶ creates and deploys Router, Deployer, Vault
 browser ───────────infra up──▶ creates GitHub App, Slack app ──┐
 CLAUDE_CODE_OAUTH_TOKEN ─────────── copied ────────────────────┤ written, never read back
                                                                ▼
                               ┌─────────────────────────────┐
                               │ Vault                       │
                               │   FACTORY_ROOT_KEY         │
                               │   connection credentials    │
                               │   account secrets           │
                               └──────┬───────────────┬──────┘
                                bound │               │ bound
                                      ▼               ▼
 GitHub, Slack ──events────────▶ Router ◀─admin key─▶ Deployer ──deploys──▶ Container
        (signed)                  ▲   │                                       FACTORY_CONTAINER_KEY
                                  │   │                                       account secrets
 operator sign-in ──session───────┘   ├──minted tokens, on a request ───────▶ token files
                                      │  signed with the container key
                                      └──channel relay ◀──────────────────── replies
```
