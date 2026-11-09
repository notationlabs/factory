# `@factory/cloudflare`

`@factory/cloudflare` runs the Notation Factory hub (`Vault`, `Router` and `Deployer`) and repository outposts on Cloudflare Workers and Durable Object Containers. Imported in `factory.infra.ts` from `@factory/cloudflare`.

```bash
@pm.dev("@factory/cloudflare")
```

## Vault, Router & Deployer

Provision the hub and outpost builder on Cloudflare:

```ts [factory.infra.ts]
import { factory, secret } from "factory";
import * as claude from "@factory/claude";
import * as cloudflare from "@factory/cloudflare";

export default factory(() => {
  const vault = new cloudflare.Vault("vault"); // <-- Secrets Store; left by `factory infra down`

  const router = new cloudflare.Router("router", {
    project: "acme-agents", // <-- prefixes Worker names, KV namespace, and R2 bucket
    vault,                  // <-- only a cloudflare.Vault
  });

  const claudeAccount = new claude.Account("claude", { auth: secret.env("CLAUDE_CODE_OAUTH_TOKEN") });

  new cloudflare.Deployer("deployer", {
    router,
    vault,
    accounts: [claudeAccount],
    knownHosts: ["ssh-ed25519 AAAA... me@laptop"], // <-- authorized_keys for outpost containers
  });
});
```

| Resource | Cloudflare resources provisioned |
| --- | --- |
| `cloudflare.Vault` | A Secrets Store store, bound to the router and deployer Workers. Values can't be read back through the API. `name` sets the store's name; it defaults to the vault's id |
| `cloudflare.Router` | KV namespace (`acme-agents`), R2 bucket (`acme-agents`), always-on `acme-agents-router` Worker + `standard-1` DO container, and the KV entry that holds the router's config. It generates `FACTORY_ROOT_KEY` into the vault |
| `cloudflare.Deployer` | Scale-to-zero `acme-agents-deployer` Worker (10m idle timeout), and an account API token of its own (`acme-agents-deployer`) for Workers Scripts and Workers Builds. It writes each account's secrets to the vault |

The KV namespace holds only non-secret variables and fingerprints. The Workers' internal key is derived from the root key inside the Workers, so `factory infra up` deploys them without reading any secret.

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
| `CLOUDFLARE_API_TOKEN` | Optional CI alternative to `npx wrangler login` |
| `CLOUDFLARE_ACCOUNT_ID` | Selects target account when login has access to multiple accounts |
