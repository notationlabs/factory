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
import { env } from "@notation/std/sources";

const vault = new cloudflare.Vault("vault"); // <-- secrets in the account's Secrets Store

const router = new cloudflare.Router("router", {
  project: "acme-agents", // <-- names the KV namespace, R2 bucket and container application
  vault,                  // <-- only a cloudflare.Vault
});

const claudeAccount = new claude.Account("claude", {
  auth: vault.secret({ id: "claude-oauth-token", source: env, key: "CLAUDE_CODE_OAUTH_TOKEN" }),
});

new cloudflare.Deployer("deployer", {
  router,
  vault,
  accounts: [claudeAccount],
  accountId: "<account id>",                     // <-- optional; defaults to CLOUDFLARE_ACCOUNT_ID
  knownHosts: ["ssh-ed25519 AAAA... me@laptop"], // <-- authorized_keys for outpost containers
});
```

The resources come from `@notation/cloudflare`. Their names are scoped to the Notation app and stage, such as `<app>--<stage>--acme-agents` for the KV namespace:

| Resource | Cloudflare resources provisioned |
| --- | --- |
| `cloudflare.Vault` | One secret in the account's Secrets Store for each secret declared in the vault, named `<app>--<stage>--<id>`. Values can't be read back through the API. `vault.secret(...)` returns Notation's `SecretGroup`. A Worker gets a secret only when the router or the deployer binds it |
| `cloudflare.Router` | KV namespace and R2 bucket named after `project`, the router Worker with a Durable Object namespace for its container, a `workers.dev` subdomain for the Worker, the router image, a container application that runs the image on one `standard-1` instance, and the KV entry that holds the router's config. It declares `router.rootKey` in the vault with the `generated()` source, and binds it as `FACTORY_ROOT_KEY`. `router.bind(secret, name?)` adds a `secrets_store_secret` binding to the router Worker |
| `cloudflare.Deployer` | The deployer Worker, and an account API token of its own with Workers Scripts Write, Workers CI Write and Workers Containers Write in `accountId`. It binds `router.rootKey` as `FACTORY_ROOT_KEY`, its API token as `CLOUDFLARE_API_TOKEN`, and each account's secrets under their env var names, such as `CLAUDE_CODE_OAUTH_TOKEN` |

The router is reached at its `workers.dev` subdomain: `https://<script>.<account subdomain>.workers.dev`. The subdomain resource's `Url` output is the router's URL, and connections set their webhooks to `<Url>/webhook`. The account needs a `workers.dev` subdomain.

The router image is built from `router-image/` in this package, and pushed to the `factory-router` repository in the account's Cloudflare registry. Its tag is a hash of the build context, so a change to the context builds a new image and rolls it out to the container application. Deploy needs Docker with buildx.

Cloudflare returns the deployer's token value only when it creates the token. Notation writes the value to a Secrets Store secret, and the deployer Worker binds it as `CLOUDFLARE_API_TOKEN`. The deployer also gets `CLOUDFLARE_ACCOUNT_ID`, `KNOWN_HOSTS` and `ACCOUNTS` as JSON bindings.

Both Workers bind the KV namespace as `FACTORY_KV`. The router binds the R2 bucket as `FACTORY_BUCKET`. The KV namespace holds the router's config and other non-secret values. The router's config names each connection's secrets by their binding names, and holds no secret values. The Workers' internal key is derived from the root key inside the Workers, so `factory infra up` deploys them without reading any secret.

The router image and the deployer Worker are placeholders, and the router Worker only matches GitHub deliveries. See [Known gaps](../manual/providers.md#known-gaps).

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
