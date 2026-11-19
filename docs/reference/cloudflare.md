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

const router = new cloudflare.Router("router", { vault }); // <-- only a cloudflare.Vault

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
  regions: ["WEUR"],                             // <-- optional; where outpost containers may run
  sleepAfter: "10m",                             // <-- optional; how long an idle container stays up
});
```

The resources come from `@notation/cloudflare`. Their names are scoped to the Notation app and stage, such as `<app>--<stage>--router` for the KV namespace:

| Resource | Cloudflare resources provisioned |
| --- | --- |
| `cloudflare.Vault` | The account's Secrets Store, as `vault.store`, and one `SecretsStoreSecret` in it for each secret declared in the vault. Notation names each secret `<app>--<stage>--secret-<id>-<instance>`. Values can't be read back through the API. `vault.secret({ id, value })` takes a credential as `value` and returns a `CloudflareSecret`. A Worker gets a secret only when the router or the deployer binds it |
| `cloudflare.Router` | KV namespace and R2 bucket named `<app>--<stage>--<id>`, the router Worker served on `workers.dev`, a Worker for each connection's channel, and the router's config, a `kvJson()` document in the KV key `config`. It generates `router.rootKey` with a `RandomKey`, keeps it in the vault, and binds it as `FACTORY_ROOT_KEY`. `router.bind(secret, name?)` binds a vault secret to the router Worker. `router.channel(...)` runs a connection's channel |
| `cloudflare.Deployer` | The deployer Worker. It binds `router.rootKey` as `FACTORY_ROOT_KEY`, the builds token as `CLOUDFLARE_BUILDS_TOKEN`, each account's secrets under their env var names, such as `CLAUDE_CODE_OAUTH_TOKEN`, and each of `secrets`, the outpost secrets, as `OUTPOST_<id>`. When a run starts, it passes the container the secrets of the accounts of its runtimes, and the outpost secrets that allow its repo. See [Outpost secrets](../manual/secrets.md#outpost-secrets). It creates an Artifacts namespace, and a builds token, a user API token that you paste on a local page. When a repo's config deploys, the deployer creates an outpost Worker for each of its containers, which hosts one container. The container's `instanceType` is one of Cloudflare's instance types: `lite`, `basic`, `standard-1`, `standard-2`, `standard-3` or `standard-4`, and defaults to `standard-1`. Any other value fails the container's deploy. Deploy writes the outpost settings, such as the deployer Worker's generated name, to a `kvJson()` document in the KV key `outpost-settings/<id>`. See [Providers](../manual/providers.md#cloudflare). With `regions`, Cloudflare starts the containers only in those regions: any of `ENAM`, `WNAM`, `EEUR`, `WEUR`, `APAC`, `SAM`, `ME`, `OC` and `AFR`, where `ME`, `OC` and `AFR` need another region next to them. Without it, Cloudflare starts a container in the location nearest to the request that has the image. A container stops once it has had no run in progress for `sleepAfter`, a number of seconds, minutes or hours such as `"30s"` or `"1h"`, which defaults to `"10m"`. Workers Builds builds each container's image from the repo's `.factory/`. A `BuildWatch` Durable Object in the deployer polls each build every 30 seconds, and posts its progress, signed with a key derived from the root key, to the router's `POST /builds` route. The router writes it to a check on the pushed commit. The deployer also binds the router's R2 bucket, where each container keeps its runs' worktrees and sessions under `outposts/<container id>/`. It bundles the runner modules of its accounts' runtimes and of the code host, and serves them to the containers' runners, so declare the code host before the deployer |

The router is reached at its `workers.dev` URL: `https://<script>.<account subdomain>.workers.dev`. `router.url` is that URL, and each connection sets its webhook to `<url>/webhook/<provider>/<id>`. The account needs a `workers.dev` subdomain.

Each connection's channel is a Worker with no URL, which binds the secrets and values that the connection gives it under their own names. The router binds it as a service, as `CHANNEL_<connection>`, such as `CHANNEL_GITHUB_GH`, and records that name in the connection's entry in its config. The router calls the channel over RPC. The channels of one provider share one bundle. Deploy builds every Worker's code from `workers/` in this package with `bundle()`.

The deployer also gets `OUTPOST_SETTINGS_KEY` and `ACCOUNTS` as JSON bindings. Destroying the deployer deletes every Worker whose name starts with its outpost prefix, and the container application of each. Cloudflare leaves a Worker's container application when it deletes the Worker, so the deployer deletes it too. It does the same when a repo drops a container.

Both Workers bind the KV namespace as `FACTORY_KV`. The router binds the R2 bucket as `FACTORY_BUCKET`. The KV namespace holds the router's config and other non-secret values. The router's config names each connection's secrets by their binding names, and holds no secret values. The Workers' internal key is derived from the root key inside the Workers, so `factory infra up` deploys them without reading any secret.

The router Worker only matches GitHub deliveries. See [Known gaps](../manual/providers.md#known-gaps).

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
| `CLOUDFLARE_API_TOKEN` | Optional CI alternative to `npx wrangler login`. Deploy uses it for the Artifacts namespace, which needs Artifacts Edit. `factory infra down` uses it to delete outpost Workers and their container applications, which needs Workers Scripts Edit and Containers Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Selects the target account when the login has access to several. `cloudflare.Deployer` uses it as its `accountId` when you don't pass one, and fails without either |
