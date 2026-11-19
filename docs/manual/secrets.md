# Secrets

Keep every secret the hub holds in one vault that only the hub can read:

```ts [factory.infra.ts]
import * as claude from "@notation/factory-claude";
import * as cloudflare from "@notation/factory-cloudflare";
import * as github from "@notation/factory-github";
import { sources } from "@notation/std/resources";

const vault = new cloudflare.Vault("vault"); // <-- 1. where the hub's secrets live

const router = new cloudflare.Router("router", { vault });

const gh = new github.Connection("gh", { org: "acme", router });
new github.CodeHost("github", { connection: gh, allow: [{ owner: "acme" }] });

new github.OperatorAuth("operators", { connection: gh, logins: ["djgrant", "alice"] }); // <-- 2. who may run the CLI against the hub

const claudeToken = new sources.Env("claude-oauth-token", {
  config: { key: "CLAUDE_CODE_OAUTH_TOKEN", track: "scrypt" }, // <-- 3. read from your environment at deploy
});

const claudeAccount = new claude.Account("claude", {
  auth: vault.secret({ id: "claude-oauth-token", value: claudeToken.credentials.value }),
});

new cloudflare.Deployer("deployer", { router, vault, accounts: [claudeAccount] });
```

A Notation Factory instance has secrets in three places: your machine, the hub (`Router` and `Deployer`), and each outpost container. This page explains what each place holds, how each secret gets there, and who can read it.

## Where secrets live

| Place | Holds | Who reads it |
| --- | --- | --- |
| **Local** | Your container provider sign-in, your `gh` login, account secrets such as `CLAUDE_CODE_OAUTH_TOKEN` | `factory` on your machine |
| **Hub vault** | `FACTORY_ROOT_KEY`, each connection's credentials (GitHub App private keys and client secrets, Slack bot tokens and signing secrets), account secrets | The `Router`, the `Deployer`, or both, depending on the secret. See [Who binds each secret](#who-binds-each-secret) |
| **Outpost** | Its `FACTORY_CONTAINER_KEY`, the secrets of the accounts whose runtimes it lists, the outpost secrets that allow its repo, short-lived code host tokens the router mints | That container; agents get the minted tokens, account secrets and outpost secrets |

**The hub vault is write-only from outside the hub.** `factory infra up` writes a secret's value to the vault's store, and never reads one back. Holding the container provider's credentials lets you replace the hub's secrets, not read them.

## The root key

`FACTORY_ROOT_KEY` is a random key. The router declares it as a `RandomKey` resource from `@notation/factory`, so `factory infra up` generates it when it creates the key, writes it to the vault, and then forgets it. Every other secret Notation Factory makes is derived from it with HMAC, so the hub stores one key instead of many:

```text
FACTORY_ROOT_KEY
 ├─ container key   HMAC(root, repo + container)               container ⇄ router, both directions
 ├─ webhook secret  HMAC(root, "github:webhook:" + App id)     GitHub ─▶ router
 ├─ admin key       HMAC(root, "admin")                        router ⇄ deployer
 ├─ session key     HMAC(root, "operator:session")             signs operators' admin sessions
 └─ internal key    HMAC(root, "cloudflare:…")                 Cloudflare Workers' private routing (*.factory.internal)
```

Neither the router nor the deployer stores a derived key. Each derives the key where the root key is bound, when it needs it. For example, the router derives `gh`'s webhook secret to verify a webhook, and derives a container's key to verify that container's request for credentials.

The deployer gives each container its own `FACTORY_CONTAINER_KEY` when it deploys the container. A container can only sign as itself, so it can't impersonate another container.

Platforms that issue their own signing secret, such as Slack, keep it in the vault as part of the connection's credentials instead of deriving one.

## The hub vault

The vault is a `Vault` from the hub's provider plugin. `vault.secret(...)` declares a secret in it, and gives the secret its value. Declaring a secret doesn't give anything access to it. The router or the deployer binds the secret to its own Worker or service, under a name it chooses.

### Credentials

A secret's value is a Notation **credential**: an output of another resource that deploy holds in memory, and that state records only as a marker. `vault.secret(...)` takes these fields:

| Field | Meaning |
| --- | --- |
| `id` | Keys the secret in Notation's state |
| `value` | A credential, such as `claudeToken.credentials.value` or `token.credentials.Value` |

A credential comes from one of two kinds of resource:

| Kind | Example | Where the value comes from |
| --- | --- | --- |
| A source | `sources.Env`, `sources.Dotenv` from `@notation/std/resources`, `InfisicalSecret` from `@notation/infisical/resources` | A place outside Notation, such as the environment variable `CLAUDE_CODE_OAUTH_TOKEN` |
| A resource that issues it | The router's `RandomKey`, a GitHub App, a Slack app, the deployer's API token | The provider returns it when it creates the resource |

For example, `github.Connection` passes its App's private key to the vault, and binds the secret to the router:

```ts
const privateKey = router.bind(          // <-- returns the binding name, here GH_PRIVATE_KEY
  router.vault.secret({
    id: "gh-private-key",
    value: app.credentials.privateKey,   // <-- GitHub returns it when it creates the App
  }),
);
```

The key goes from the App to the vault in the deploy's memory. No one copies it by hand.

`router.bind(secret, name?)` binds the secret to the router's Worker or service, and returns the binding name. Without `name`, the binding name is made from the secret's id with `bindingName(id)` from `@notation/factory`. `bindingName` makes the id upper case, and replaces each character other than a letter, a digit or `_` with `_`. If the result starts with a digit, it adds `_` in front. For example, `gh-private-key` becomes `GH_PRIVATE_KEY`. A connection records the binding names in its entry in the router's config.

The factory doesn't choose the secret's name in the store. The vault's provider makes a name scoped to the Notation app and stage, so two stages of one hub keep separate secrets:

| Provider | `Vault` | Each secret is | Name in the store |
| --- | --- | --- | --- |
| Cloudflare | `cloudflare.Vault` | A secret in the account's Secrets Store. Values can't be read back through the API. Workers read it through a `secrets_store_secret` binding | `<app>--<stage>--secret-<id>-<instance>`, where Notation generates the 8 hex characters of the instance |
| Railway | `railway.Vault` | A sealed shared variable in the router's project. Values are never shown in the dashboard or returned by the API. A service reads it through a variable named after the binding name, whose value is `${{shared.<name>}}` | `<app>__<stage>__<id>`, with characters other than letters, digits and `_` replaced by `_` |

**The vault and the hub are always on the same provider.** `cloudflare.Router` and `cloudflare.Deployer` take only a `cloudflare.Vault`. A vault elsewhere would need its own access credential, and that credential would have to live in the hub provider's store anyway.

### When a value is written

Deploy writes a secret when it creates it, and again when the credential has a new version:

| Credential | `factory infra up` writes the secret |
| --- | --- |
| `sources.Env` or `sources.Dotenv` without `track` | On every deploy. The variable must be set on every machine that deploys |
| `sources.Env` or `sources.Dotenv` with `track: "scrypt"` | When the value changes. State holds a salted hash of the value |
| The router's `RandomKey` | Once, when it creates the key |
| A GitHub App's private key and client secret, a Slack app's tokens | Once, when it creates the App |
| The deployer's API token | Once, when it creates the token |

The example at the top of this page sets `track: "scrypt"` on the Claude token, because the token is generated and can't be guessed from its hash. For a value that a person chose, use `track: "hmac"` with `NOTATION_TRACK_KEY`. See Notation's [Secrets](https://github.com/notationlabs/notation/blob/main/docs/manual/secrets.md#tracking-a-value) page.

### A credential that deploy can't get again

Deploy holds a value only in the process that received it. When a secret needs a value that an earlier deploy received, deploy has to get it again. For example, the Secrets Store secret was deleted in the dashboard, or a deploy failed after it created the App and before it wrote the secret. What deploy does depends on the credential:

| Credential | Deploy |
| --- | --- |
| A source | Reads the value from the source again |
| The router's `RandomKey` | Rotates it: makes a new value, and writes every secret that holds it |
| A GitHub App's private key or client secret, a Slack app's tokens, the Railway deployer's token | Fails, because the provider has no API that issues another value |

**For the last row, plan and deploy fail and print two commands.** One command passes a value that you issue at the provider, such as a private key that you generate on the GitHub App's settings page:

```sh
notation deploy --stage prod --credential gh-app.privateKey@<version>=GH_PRIVATE_KEY
```

The other command replaces the resource, which creates a new App. See [notation deploy](https://github.com/notationlabs/notation/blob/main/docs/cli/deploy.md#a-credential-that-you-rotate-by-hand). `factory infra up` passes `--credential` on to Notation, so you can run `factory infra up --credential …` instead.

### The secrets in the vault

For the example at the top of this page, the vault holds these secrets:

| Secret `id` | Binding name | Declared by | Bound by | Value from |
| --- | --- | --- | --- | --- |
| `router-root-key` | `FACTORY_ROOT_KEY` | `Router`, as `router.rootKey` | Router and deployer | The router's `RandomKey` |
| `gh-private-key` | `PRIVATE_KEY` | `github.Connection` | The connection's channel | The App, `app.credentials.privateKey` |
| `gh-client-secret` | `CLIENT_SECRET` | `github.Connection` | The connection's channel | The App, `app.credentials.clientSecret` |
| `slack-bot-token`, `slack-signing-secret` | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | `slack.Connection`, if the hub has one | Router | The Slack app, `botToken` and `signingSecret` |
| `deployer-builds-token` | `CLOUDFLARE_BUILDS_TOKEN` | `Deployer` | Deployer | The builds token, which you paste on a local page during the first `factory infra up` |
| `claude-oauth-token` | `CLAUDE_CODE_OAUTH_TOKEN` | You, in the account's `auth` | Deployer | `sources.Env` |

A connection's secret ids start with the connection's id, and the router makes each binding name from the id. So several connections of one provider each get their own bindings. For example, connections with the ids `gh` and `personal` bind `GH_PRIVATE_KEY` and `PERSONAL_PRIVATE_KEY`.

The deployer binds an account's secrets under the env var names that the account gives them, such as `CLAUDE_CODE_OAUTH_TOKEN`. The secret's id is yours to choose.

### Who binds each secret

Each Worker or service binds only the secrets it uses:

| Secret | Router | Deployer |
| --- | --- | --- |
| `FACTORY_ROOT_KEY` | Bound by the router | Bound by the deployer |
| Connection credentials | Bound by each connection, with `router.bind(...)` | Not bound |
| The deployer's provider token | Not bound | Bound by the deployer |
| Account secrets | Not bound | Bound by the deployer, for each of its `accounts` |
| Outpost secrets | Not bound | Bound by the deployer, for each of its `secrets` |

**The router never binds an account's secrets, and the deployer never binds a connection's credentials.** A leak of one Worker or service therefore exposes only the secrets it binds, plus the root key.

On Cloudflare, a binding is a `secrets_store_secret` entry in the Worker's `Bindings`. On Railway, it is a variable on the service.

### The deployer's provider token

The deployer has a provider token of its own, which it owns as a resource and keeps in the vault:

| Provider | Token | The deployer reads it as |
| --- | --- | --- |
| Cloudflare | The builds token, a user API token with the seven permissions that `factory infra up` fills in on Cloudflare's create-token page | `CLOUDFLARE_BUILDS_TOKEN` |
| Railway | A project token | `RAILWAY_TOKEN` |

### Losing the vault

The vault's secrets belong to the hub's Notation stage, so `factory infra down` deletes them along with the router and deployer. On Cloudflare, every hub on the account shares the account's one Secrets Store. The first hub creates the store, and each later hub uses it. `factory infra down` deletes only the hub's own secrets, by their `<app>--<stage>--` names, and leaves the store and the other hubs' secrets. When you bring the hub up again, or move it to another provider:

- `factory infra up` generates a new root key, and the router re-derives every webhook secret and container key.
- The GitHub Apps survive, but deploy doesn't hold their private keys or client secrets. Generate a new private key and a new client secret on each App's page, and pass them with `--credential`.
- For a Slack app, pass its bot token and signing secret with `--credential`.
- Account secrets are written again from their sources.

## Local credentials

`factory infra up` and `factory infra down` create, update and delete the hub, so they authenticate with your own credentials:

| Step | Credential |
| --- | --- |
| Create and deploy the hub on Cloudflare | `npx wrangler login`, or `CLOUDFLARE_API_TOKEN` (e.g. in CI). See [Providers](./providers.md#cloudflare) for the permissions that `CLOUDFLARE_API_TOKEN` needs |
| Choose the deployer's Cloudflare account | `CLOUDFLARE_ACCOUNT_ID`, or `accountId` on `cloudflare.Deployer` |
| Create and deploy the hub on Railway | `RAILWAY_API_TOKEN` |
| Create a GitHub App or Slack app | Your browser, through the platform's manifest flow |
| Calls to GitHub as you, e.g. `factory repo install` | Your `gh` login |
| Write account secrets to the vault | The account's source, e.g. `CLAUDE_CODE_OAUTH_TOKEN` in your environment for `sources.Env` |

The `infra` commands check each one before they start, and their messages name the credential that's missing or refused.

You can load them at startup with `loadEnv` in `factory.config.ts`, beside `factory.infra.ts`:

```ts [factory.config.ts]
export default {
  loadEnv: "./with-env.sh", // <-- every factory command adopts the environment this sets
};
```

`loadEnv` is a command prefix: `./with-env.sh` stands for any command that sets variables and then runs the command after it, such as your secret manager's CLI. `factory` runs it once when it starts and takes on the environment it sets, so your terminal stays attached.

## Operator auth

Commands that talk to a running hub sign you in as an operator instead of using the root key: `factory infra status`, `factory infra replay`, and the repo sync at the end of `factory infra up`. The router checks who you are and returns an admin session, signed with a key derived from the root key, that lasts 4 hours. The router also checks that the session's operator is still in the operator auth on each request, so removing an operator ends their session. `factory infra status` and `factory infra replay` need no provider credentials at all. See [Operator sign-in](./cli.md#operator-sign-in).

**Operators are not the code host's `allow` list.** `allow` on `CodeHost` decides whose repos get outposts. Operators are the people allowed to run the CLI against the hub.

Each `OperatorAuth` decides who you are differently:

| `OperatorAuth` | You sign in with | Who decides access |
| --- | --- | --- |
| `github.OperatorAuth` | GitHub, through the connection's App, in your browser | The router, against `logins` |
| `cloudflare.OperatorAuth` | Cloudflare Access, in your browser | Cloudflare Access, against `emails`; the router verifies Access's token. The router can't sign operators in this way yet |

### Signing in with GitHub

`github.OperatorAuth` uses GitHub's web flow for the connection's App:

1. The CLI asks the router for GitHub's sign-in page, and opens it in your browser.
2. You authorize the App. GitHub sends your browser to `http://127.0.0.1:47219/callback` with a code, where the CLI listens.
3. The CLI sends the code to the router. The connection's channel exchanges it for a user token with the App's client secret, reads your login with the token, and revokes the token.
4. The router checks your login against `logins`, without case, and returns the admin session.

The App needs two things for this, which Factory sets up when it creates the App:

- The client secret, in the vault as `<connection>-client-secret`, which only the connection's channel binds.
- The callback URL `http://127.0.0.1:47219/callback`. GitHub only sends the browser to an App's callback URLs, port included.

An App that an earlier version of Factory created, such as `notation-factory`, has neither, and the next deploy fails because it can't get the client secret. Set them up on the App's settings page:

1. Under **Identifying and authorizing users**, add the callback URL `http://127.0.0.1:47219/callback`, and save.
2. Under **Client secrets**, generate a new client secret, and copy it.
3. Put it in an environment variable, and pass it to the deploy that the error message names, such as:

```sh
GH_CLIENT_SECRET=… factory infra up --credential gh-app.clientSecret@<version>=GH_CLIENT_SECRET
```

The error prints the command with its `<version>`.

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

Outposts declare no secrets of their own. The deployer gives each container its `FACTORY_CONTAINER_KEY` when it deploys it, stored as the provider's own secret (a Worker secret on Cloudflare, a sealed variable on Railway). When a run starts, the deployer reads these through its own bindings and passes them to the container as env vars:

- the secrets of every account whose runtime the container lists
- the outpost secrets that allow the container's repo

A container that lists only `claude.runtime`, in a repo that no outpost secret allows, gets the Claude account's token and nothing else.

Agents never see `FACTORY_CONTAINER_KEY` or any provider's private variables. They see the minted tokens, the account secrets and the outpost secrets.

### Outpost secrets

An `OutpostSecret` from `@notation/factory` is a secret that the hub holds for the containers of some repos, such as a database URL that an agent needs. Declare it in `factory.infra.ts`, and pass it to the deployer:

```ts [factory.infra.ts]
import { OutpostSecret } from "@notation/factory";
// …
const databaseUrl = new sources.Env("web-database-url", {
  config: { key: "WEB_DATABASE_URL", track: "hmac" },
});

const webDatabase = new OutpostSecret("web-database-url", {
  name: "DATABASE_URL",                       // <-- 1. the env var name containers read it as
  value: databaseUrl.credentials.value,       // <-- 2. a credential, as for vault.secret
  allowedRepos: [{ owner: "acme", repo: "web" }], // <-- 3. the repos whose containers get it
});

new cloudflare.Deployer("deployer", { router, vault, accounts: [claudeAccount], secrets: [webDatabase] });
```

`allowedRepos` has the form of the code host's `allow`: a pattern without `repo` allows every repo of its owner. The deployer writes the value to the vault as the secret `outpost-<id>`, and binds it as `OUTPOST_<id>`, made with `bindingName`. Every container of an allowed repo gets it, whatever its runtimes.

`factory infra up` fails if a container could get two values for one env var: two outpost secrets with the same `name` whose `allowedRepos` overlap, or an outpost secret with the name of an account's secret.

The agents in those containers can read the value, so give an outpost secret no more access than you would give the agents. For a database, that's a role with only the privileges the agents need.

An outpost Worker built by an earlier version of Factory doesn't pass its repo to the deployer, so its containers get no outpost secrets until the outpost deploys again and rebuilds it.

## Topology

Taken together, secrets flow one way, from your machine into the vault and from the vault out to services and containers:

```text
 LOCAL                               HUB                                        OUTPOST
 ─────                               ───                                        ───────
 provider sign-in ──infra up──▶ creates and deploys Router, Deployer, Vault
 browser ───────────infra up──▶ creates GitHub App, Slack app
 CLAUDE_CODE_OAUTH_TOKEN ──── from its source ──┐
 App keys, tokens ──── from their resources ────┤ written, never read back
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
