# `@notation/factory-cloudflare`

`@notation/factory-cloudflare` runs the Notation Factory hub (`Vault`, `Router` and `Deployer`) and repository outposts on Cloudflare Workers and Durable Object Containers. Imported in `factory.infra.ts` from `@notation/factory-cloudflare`.

```bash
@pm.dev("@notation/factory-cloudflare")
```

## Vault, Router & Deployer

Provision the hub and outpost builder on Cloudflare:

```ts [factory.infra.ts]
import * as claude from "@notation/factory-claude";
import * as cloudflare from "@notation/factory-cloudflare";
import { sources } from "@notation/std/resources";

const vault = new cloudflare.Vault("vault"); // <-- secrets in the account's Secrets Store

const router = new cloudflare.Router("router", {
  project: "acme-agents", // <-- names the KV namespace and R2 bucket
  vault,                  // <-- only a cloudflare.Vault
});

const claudeToken = new sources.Env("claude-oauth-token", {
  config: { key: "CLAUDE_CODE_OAUTH_TOKEN", track: "scrypt" },
});
const claudeAccount = new claude.Account("claude", {
  auth: vault.secret({ id: "claude-oauth-token", value: claudeToken.credentials.value }),
});

new cloudflare.Deployer("deployer", {
  router,
  vault,
  accounts: [claudeAccount],
  accountId: "<account id>",                     // <-- optional; defaults to CLOUDFLARE_ACCOUNT_ID
  knownHosts: ["ssh-ed25519 AAAA... me@laptop"], // <-- authorized_keys for outpost containers
  maxContainers: 10,                             // <-- optional; the most outpost containers awake at once
});
```

The resources come from `@notation/cloudflare`. Their names are scoped to the Notation app and stage, such as `<app>--<stage>--acme-agents` for the KV namespace:

| Resource | Cloudflare resources provisioned |
| --- | --- |
| `cloudflare.Vault` | The account's Secrets Store, as `vault.store`, and one `SecretsStoreSecret` in it for each secret declared in the vault. Notation names each secret `<app>--<stage>--secret-<id>-<instance>`. Values can't be read back through the API. `vault.secret({ id, value })` takes a credential as `value` and returns a `CloudflareSecret`. A Worker gets a secret only when the router or the deployer binds it |
| `cloudflare.Router` | KV namespace and R2 bucket named after `project`, the router Worker served on `workers.dev`, a Worker for each connection's channel, and the router's config, a `kvJson()` document in the KV key `config`. It generates `router.rootKey` with a `RandomKey`, keeps it in the vault, and binds it as `FACTORY_ROOT_KEY`. `router.bind(secret, name?)` binds a vault secret to the router Worker. `router.channel(...)` runs a connection's channel |
| `cloudflare.Deployer` | The deployer Worker, and an account API token of its own with Workers Scripts Write, Workers CI Write and Workers Containers Write in `accountId`. It binds `router.rootKey` as `FACTORY_ROOT_KEY`, its API token as `CLOUDFLARE_API_TOKEN`, and each account's secrets under their env var names, such as `CLAUDE_CODE_OAUTH_TOKEN`. It hosts `OutpostContainer`, a Durable Object namespace with a `standard-1` container for each repo and container id. Deploy builds the container's image with local Docker: it holds the accounts' runtimes and the runner |

The router is reached at its `workers.dev` URL: `https://<script>.<account subdomain>.workers.dev`. `router.url` is that URL, and each connection sets its webhook to `<url>/webhook/<provider>/<name>`. The account needs a `workers.dev` subdomain.

Each connection's channel is a Worker with no URL, which binds the secrets and values that the connection gives it under their own names. The router binds it as a service, as `CHANNEL_<connection>`, such as `CHANNEL_GITHUB_ACME_AGENTS`, and records that name in the connection's entry in its config. The router calls the channel over RPC. The channels of one provider share one bundle. Deploy builds every Worker's code from `workers/` in this package with `bundle()`.

The deployer's token is a `tokens.AccountToken`. Cloudflare returns its value only when it creates the token, and deploy passes the value to a vault secret in memory. The deployer Worker binds the secret as `CLOUDFLARE_API_TOKEN`. When deploy needs the value again, such as after the secret was deleted, it rolls the token. The deployer also gets `CLOUDFLARE_ACCOUNT_ID`, `KNOWN_HOSTS` and `ACCOUNTS` as JSON bindings.

Both Workers bind the KV namespace as `FACTORY_KV`. The router binds the R2 bucket as `FACTORY_BUCKET`. The KV namespace holds the router's config and other non-secret values. The router's config names each connection's secrets by their binding names, and holds no secret values. The Workers' internal key is derived from the root key inside the Workers, so `factory infra up` deploys them without reading any secret.

The deployer Worker is a placeholder, and the router Worker only matches GitHub deliveries. See [Known gaps](../manual/providers.md#known-gaps).

## Operator auth

Put Cloudflare Access in front of the router's admin routes:

```ts [factory.infra.ts]
// …
new cloudflare.OperatorAuth("operators", {
  router,                                    // <-- the Access application sits in front of its admin routes
  emails: ["dj@acme.dev", "alice@acme.dev"], // <-- who Access lets in
});
```

The CLI signs you in to Access in your browser. Access decides who gets in, and the router verifies Access's token before it returns a short-lived admin session.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Optional CI alternative to `npx wrangler login`. Creating the deployer's token needs the Account API Tokens: Edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | Selects the target account when the login has access to several. `cloudflare.Deployer` uses it as its `accountId` when you don't pass one, and fails without either |
