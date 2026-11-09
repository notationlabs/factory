# Container Providers

A Notation Factory hub runs its `Router`, `Deployer`, and every outpost `Container` on one provider plugin, such as `@factory/cloudflare`. `.factory/config.ts` stays provider-agnostic, so you can switch providers in `factory.infra.ts` without touching subscriber repositories.

| Capability | Cloudflare (`@factory/cloudflare`) | Railway (`@factory/railway`) |
| --- | --- | --- |
| **Compute** | Worker + `standard-1` Durable Object container | Railway Service per router, deployer, and outpost |
| **Private network** | Authenticated Worker routing (`*.factory.internal`) | Railway private network (`*.railway.internal`) |
| **Service store** | Durable Object storage | JSON files on `/data` volume |
| **Vault** | `cloudflare.Vault` (Secrets Store) | `railway.Vault` (sealed variables) |
| **Outpost `/data` disk** | DO disk snapshots + R2 archive across image rebuilds | Railway persistent volume at `/data` |
| **Image builds** | Cloudflare Workers Builds | Railway GitHub builder |
| **Container SSH** | `wrangler containers ssh` (`knownHosts` on `Deployer`) | `railway ssh` (`railway login`) |

The vault is always on the hub's provider: `cloudflare.Router` and `cloudflare.Deployer` take a `cloudflare.Vault`, and `railway.Router` and `railway.Deployer` take a `railway.Vault`. See [Secrets](./secrets.md).

## Cloudflare

Run the hub and outposts on Cloudflare Workers and Durable Object Containers:

```ts [factory.infra.ts]
export default factory(() => {
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
    knownHosts: ["ssh-ed25519 AAAA... dev@acme"], // <-- written to outpost authorized_keys for `factory container ssh`
  });
});
```

| Credential | Used by | Setup |
| --- | --- | --- |
| **Local sign-in** | `factory infra up` and `factory infra down` (KV, R2, Secrets Store, Workers) | `npx wrangler login` (or `CLOUDFLARE_API_TOKEN` in CI) |
| **Deployer token** | `cloudflare.Deployer` (Workers Scripts and Workers Builds) | An account API token of the deployer's own, created by `factory infra up` with your sign-in |

The project's KV namespace holds only non-secret variables (URLs, plugin lists, project names) and fingerprints of secrets. Secrets are only in Secrets Store or Worker secrets.

| `/data` lifecycle event | Snapshot mechanism |
| --- | --- |
| **Idle sleep (10m)** | Durable Object snapshots `/data` and restores it when woken (~1.5s) |
| **Dockerfile rebuild** | Archives previous `/data` snapshot to R2, extracts onto the new image, and re-snapshots |

## Railway

Run the hub and outposts as services inside a Railway project:

```ts [factory.infra.ts]
export default factory(() => {
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
