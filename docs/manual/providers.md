# Container Providers

A Notation Factory hub runs its `Router`, `Deployer`, and every outpost `Container` on one provider plugin, such as `@notation/factory-cloudflare`. `.factory/config.ts` stays provider-agnostic, so you can switch providers in `factory.infra.ts` without touching subscriber repositories.

| Capability | Cloudflare (`@notation/factory-cloudflare`) | Railway (`@notation/factory-railway`) |
| --- | --- | --- |
| **Compute** | Worker + `standard-1` Durable Object container | Railway Service per router, deployer, and outpost |
| **Private network** | Authenticated Worker routing (`*.factory.internal`) | Railway private network (`*.railway.internal`) |
| **Service store** | Durable Object storage | JSON files on `/data` volume |
| **Vault** | `cloudflare.Vault` (Secrets Store) | `railway.Vault` (sealed shared variables) |
| **Outpost `/data` disk** | DO disk snapshots + R2 archive across image rebuilds | Railway persistent volume at `/data` |
| **Image builds** | Cloudflare Workers Builds | Railway GitHub builder |
| **Container SSH** | `wrangler containers ssh` (`knownHosts` on `Deployer`) | `railway ssh` (`railway login`) |

The vault is always on the hub's provider: `cloudflare.Router` and `cloudflare.Deployer` take a `cloudflare.Vault`, and `railway.Router` and `railway.Deployer` take a `railway.Vault`. See [Secrets](./secrets.md).

## Cloudflare

Run the hub and outposts on Cloudflare Workers and Durable Object Containers:

```ts [factory.infra.ts]
// …
const vault = new cloudflare.Vault("vault");

const router = new cloudflare.Router("router", {
  project: "acme-agents",
  vault,
});

new cloudflare.Deployer("deployer", {
  router,
  vault,
  accounts: [claudeAccount],
  accountId: "<account id>", // <-- optional; defaults to CLOUDFLARE_ACCOUNT_ID
  knownHosts: ["ssh-ed25519 AAAA... dev@acme"], // <-- written to outpost authorized_keys for `factory container ssh`
});
```

| Credential | Used by | Setup |
| --- | --- | --- |
| **Local sign-in** | `factory infra up` and `factory infra down` (KV, R2, Secrets Store, Workers, Containers, API tokens) | `npx wrangler login` (or `CLOUDFLARE_API_TOKEN` in CI). Plan also needs the Containers: Edit permission, because it reads the router image from the registry |
| **Docker** | `factory infra up`, to build and push the router image | Docker with buildx, installed and running on the machine that deploys |
| **Deployer token** | `cloudflare.Deployer` (Workers Scripts Write, Workers CI Write, Workers Containers Write) | An account API token of the deployer's own, created by `factory infra up` with your sign-in. Its value goes to a Secrets Store secret, and the deployer Worker binds it as `CLOUDFLARE_API_TOKEN` |

The project's KV namespace holds the router's config and other non-secret values. The router's config names each connection's secrets by their binding names, and holds no secret values. Secrets are only in the Secrets Store or in Worker secrets.

| `/data` lifecycle event | Snapshot mechanism |
| --- | --- |
| **Idle sleep (10m)** | Durable Object snapshots `/data` and restores it when woken (~1.5s) |
| **Dockerfile rebuild** | Archives previous `/data` snapshot to R2, extracts onto the new image, and re-snapshots |

## Railway

Run the hub and outposts as services inside a Railway project:

```ts [factory.infra.ts]
// …
const vault = new railway.Vault("vault");

const router = new railway.Router("router", {
  project: "acme-agents",
  vault,
});

new railway.Deployer("deployer", {
  router,
  vault,
  accounts: [claudeAccount],
});
```

| Credential | Used by | Setup |
| --- | --- | --- |
| `RAILWAY_API_TOKEN` | `factory infra up` and `factory infra down` | Export in your environment, or load it with `loadEnv` in `factory.config.ts` |
| **Deployer token** | `railway.Deployer` (outpost services) | A project token of the deployer's own, created by `factory infra up` |
| `railway login` | `factory container ssh` + `resume` | Local Railway CLI session |

## Builder access

Cloud providers build `.factory/Dockerfile` through their own GitHub App (**Cloudflare Workers and Pages** or **Railway App**):

```text
1. `factory repo install` ──► Deployer checks builder access to `acme/webapp`
2. Missing access      ──► Writes builder install URL to `FACTORY_STATUS`
3. Browser prompt      ──► Grant builder App access to `acme/webapp`
4. Auto-retry          ──► Deployer builds `.factory/Dockerfile`
```

## Known gaps

The provider plugins don't yet do all that these pages describe:

| Gap | Effect |
| --- | --- |
| The router image is a placeholder | `cloudflare.Router` builds its image from `router-image/Dockerfile` in `@notation/factory-cloudflare`. That Dockerfile only runs `sleep`, because the router's container doesn't exist yet |
| The router only matches deliveries | The router asks each channel provider to verify and parse a delivery, reads the outpost of the delivery's repo from KV, and returns the triggers it matches. It doesn't run them yet. Only GitHub implements the router's channel contract, and it doesn't check `github.team(...)`. A channel matches only when its `scope` is set and equals the delivery's, so the deployer will have to fill in the default scope. A channel scoped to another repo matches only deliveries that reach that repo's outpost |
| Nothing calls the router's GitHub sync yet | After a deploy, run `curl -X POST <Url>/sync` to set the App's webhook URL and secret. Later, `factory infra up` will call it |
| The deployer Worker is a placeholder | `pnpm build` in `@notation/factory-cloudflare` bundles the router Worker to `dist/router/index.mjs`, and a placeholder deployer to `dist/deployer/index.mjs`. The package doesn't publish the bundles yet |
| A changed Railway secret reaches a service only when the service redeploys | Railway resolves a `${{shared.<name>}}` reference when it deploys the service. Writing a new value to the sealed variable doesn't redeploy the router or deployer |
