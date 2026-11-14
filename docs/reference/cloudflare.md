# `@notation/factory-cloudflare`

`@notation/factory-cloudflare` runs the Notation Factory hub (`Vault`, `Router` and `Deployer`) and repository outposts on Cloudflare Workers and Durable Object Containers. Imported in `factory.infra.ts` from `@notation/factory-cloudflare`.

```bash
@pm.dev("@notation/factory-cloudflare")
```

## Vault, Router & Deployer

Provision the hub and outpost builder on Cloudflare:

```ts [factory.infra.ts]
import { factory } from "@notation/factory";
import * as claude from "@notation/factory-claude";
import * as cloudflare from "@notation/factory-cloudflare";
import { env } from "@notation/std/sources";

export default factory(() => {
  const vault = new cloudflare.Vault("vault"); // <-- secrets in the account's Secrets Store

  const router = new cloudflare.Router("router", {
    project: "acme-agents", // <-- names the KV namespace, R2 bucket and container application
    image: "registry.cloudflare.com/<account>/factory-router@sha256:<digest>", // <-- pinned by digest
    vault,                  // <-- only a cloudflare.Vault
  });

  const claudeAccount = new claude.Account("claude", {
    auth: { source: env, key: "CLAUDE_CODE_OAUTH_TOKEN" },
  });

  new cloudflare.Deployer("deployer", {
    router,
    vault,
    accounts: [claudeAccount],
    accountId: "<account id>",                     // <-- optional; defaults to CLOUDFLARE_ACCOUNT_ID
    knownHosts: ["ssh-ed25519 AAAA... me@laptop"], // <-- authorized_keys for outpost containers
  });
});
```

The resources come from `@notation/cloudflare`. Their names are scoped to the Notation app and stage, such as `<app>--<stage>--acme-agents` for the KV namespace:

| Resource | Cloudflare resources provisioned |
| --- | --- |
| `cloudflare.Vault` | One secret in the account's Secrets Store for each secret declared in the vault, named `<app>--<stage>--<id>`. Values can't be read back through the API. Each Worker binds only the secrets that list it as a consumer |
| `cloudflare.Router` | KV namespace and R2 bucket named after `project`, the router Worker with a Durable Object namespace for its container, a `workers.dev` subdomain for the Worker, a container application that runs `image` on one `standard-1` instance, and the KV entry that holds the router's config. It declares `FACTORY_ROOT_KEY` in the vault with the `generated()` source |
| `cloudflare.Deployer` | The deployer Worker, and an account API token of its own with Workers Scripts Write, Workers CI Write and Containers Write in `accountId`. It declares each account's secrets in the vault, bound to the deployer only |

The router is reached at its `workers.dev` subdomain: `https://<script>.<account subdomain>.workers.dev`. The subdomain resource's `Url` output is the router's URL, and connections set their webhooks to `<Url>/webhook`. The account needs a `workers.dev` subdomain.

`image` must end in `@sha256:` and a 64-character hex digest. A new image pushed under the same tag starts no rollout, so the digest is what makes a new image deploy.

Cloudflare returns the deployer's token value only when it creates the token. Notation writes the value to a Secrets Store secret, and the deployer Worker binds it as `CLOUDFLARE_API_TOKEN`. The deployer also gets `CLOUDFLARE_ACCOUNT_ID`, `KNOWN_HOSTS` and `ACCOUNTS` as plain text bindings, each holding JSON.

Both Workers bind the KV namespace as `FACTORY_KV`. The KV namespace holds the router's and outposts' configs, which name secrets by their bindings and hold no secret values. The Workers' internal key is derived from the root key inside the Workers, so `factory infra up` deploys them without reading any secret.

The R2 bucket isn't bound to the router yet, nothing builds the router image, and the Worker bundles aren't shipped yet. See [Known gaps](../manual/providers.md#known-gaps).

## Operator auth

Put Cloudflare Access in front of the router's admin routes:

```ts [factory.infra.ts]
export default factory(() => {
  // …
  new cloudflare.OperatorAuth("operators", {
    router,                                    // <-- the Access application sits in front of its admin routes
    emails: ["dj@acme.dev", "alice@acme.dev"], // <-- who Access lets in
  });
});
```

The CLI signs you in to Access in your browser. Access decides who gets in, and the router verifies Access's token before it returns a short-lived admin session.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Optional CI alternative to `npx wrangler login`. Creating the deployer's token needs the Account API Tokens: Edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | Selects the target account when the login has access to several. `cloudflare.Deployer` uses it as its `accountId` when you don't pass one, and fails without either |
