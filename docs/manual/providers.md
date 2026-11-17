# Container Providers

A Notation Factory hub runs its `Router`, `Deployer`, and every outpost `Container` on one provider plugin, such as `@notation/factory-cloudflare`. `.factory/config.ts` stays provider-agnostic, so you can switch providers in `factory.infra.ts` without touching subscriber repositories.

Cloudflare (`@notation/factory-cloudflare`) is the only provider today.

| Capability | Cloudflare (`@notation/factory-cloudflare`) |
| --- | --- |
| **Compute** | Workers for the router, the deployer and each connection's channel, and `standard-1` Durable Object containers for outposts |
| **Private network** | Authenticated Worker routing (`*.factory.internal`) |
| **Service store** | Durable Object storage |
| **Vault** | `cloudflare.Vault` (Secrets Store) |
| **Outpost `/data` disk** | DO disk snapshots + R2 archive across image rebuilds |
| **Image builds** | Cloudflare Workers Builds |
| **Container SSH** | `wrangler containers ssh` (`knownHosts` on `Deployer`) |

The vault is always on the hub's provider: `cloudflare.Router` and `cloudflare.Deployer` take a `cloudflare.Vault`. See [Secrets](./secrets.md).

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
| **Local sign-in** | `factory infra up` and `factory infra down` (KV, R2, Secrets Store, Workers, Containers, API tokens) | `npx wrangler login` (or `CLOUDFLARE_API_TOKEN` in CI) |
| **Deployer token** | `cloudflare.Deployer` (Workers Scripts Write, Workers CI Write, Workers Containers Write) | An account API token of the deployer's own, created by `factory infra up` with your sign-in. Its value goes to a Secrets Store secret, and the deployer Worker binds it as `CLOUDFLARE_API_TOKEN` |

The project's KV namespace holds the router's config and other non-secret values. The router's config names each connection's secrets by their binding names, and holds no secret values. Secrets are only in the Secrets Store or in Worker secrets.

| `/data` lifecycle event | Snapshot mechanism |
| --- | --- |
| **Idle sleep (10m)** | Durable Object snapshots `/data` and restores it when woken (~1.5s) |
| **Dockerfile rebuild** | Archives previous `/data` snapshot to R2, extracts onto the new image, and re-snapshots |

## Builder access

Cloudflare builds `.factory/Dockerfile` through its own GitHub App, **Cloudflare Workers and Pages**:

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
| The router only matches deliveries | The router asks the connection's channel to verify and parse a delivery, reads the outpost of the delivery's repo from KV, and returns the triggers it matches. It doesn't run them yet. Only GitHub implements the channel contract, and it doesn't check `github.team(...)`. A channel matches only when its `scope` is set and equals the delivery's, so the deployer will have to fill in the default scope. A channel scoped to another repo matches only deliveries that reach that repo's outpost |
| Nothing calls the router's sync yet | After a deploy, run `curl -X POST <Url>/sync` to set each GitHub App's webhook URL and secret. Later, `factory infra up` will call it |
| The deployer Worker is a placeholder | `workers/deployer.ts` in `@notation/factory-cloudflare` only returns a placeholder response |
