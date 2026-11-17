# Container Providers

A Notation Factory hub runs its `Router`, `Deployer`, and every outpost `Container` on one provider plugin, such as `@notation/factory-cloudflare`. `.factory/config.ts` stays provider-agnostic, so you can switch providers in `factory.infra.ts` without touching subscriber repositories.

| Capability | Cloudflare (`@notation/factory-cloudflare`) | Railway (`@notation/factory-railway`) |
| --- | --- | --- |
| **Compute** | Workers for the router, the deployer and each connection's channel, and `standard-1` Durable Object containers for outposts | Railway Service per router, deployer, and outpost |
| **Private network** | Authenticated Worker routing (`*.factory.internal`) | Railway private network (`*.railway.internal`) |
| **Service store** | Durable Object storage | JSON files on `/data` volume |
| **Vault** | `cloudflare.Vault` (Secrets Store) | `railway.Vault` (sealed shared variables) |
| **Outpost `/data` disk** | DO disk snapshots + R2 archive across image rebuilds | Railway persistent volume at `/data` |
| **Image builds** | Cloudflare Workers Builds (today: one hub image, built by `factory infra up` with local Docker) | Railway GitHub builder |
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
  regions: ["WEUR"], // <-- optional; where outpost containers may run
});
```

| Credential | Used by | Setup |
| --- | --- | --- |
| **Local sign-in** | `factory infra up` and `factory infra down` (KV, R2, Secrets Store, Workers, Containers, API tokens) | `npx wrangler login` (or `CLOUDFLARE_API_TOKEN` in CI) |
| **Docker** | `factory infra up`, which builds the outpost image for `linux/amd64` and pushes it to your account's Cloudflare registry | A running Docker daemon, such as Docker Desktop or OrbStack |
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
| The router runs only GitHub's triggers | Only GitHub implements the channel contract. The router doesn't check `github.team(...)`, so a trigger whose `from` names only teams starts no run. A channel scoped to another repo matches only deliveries that reach that repo's outpost. The router mints tokens only for `github.Policy`: a custom `Policy` gets none |
| The CLI has only `factory infra up`, `factory infra down`, `factory repo install` and `factory repo status` | `factory repo install` opens GitHub's install page with the repo selected, and waits for you to press Enter. It then waits up to two minutes for `FACTORY_STATUS`. GitHub only sends an event for a new install, so a repo that already had the App installed deploys on its next push to the default branch |
| The deployer doesn't check configs, or build repos' images | An install, or a push to the default branch, has the router read `.factory/` through the GitHub channel. The deployer evaluates it with the Worker Loader and stores the outpost config, and the router writes `FACTORY_STATUS`. The deployer doesn't run the checks in [Outposts](./outposts.md#subscribing--deploys). Every outpost container runs one image, which `factory infra up` builds with your local Docker from the accounts' runtimes and the runner. It ignores `.factory/Dockerfile`, and doesn't use Workers Builds |
| A container keeps only its worktrees and sessions while it sleeps | After each run, the runner saves the run's worktree to R2 as a git bundle, with every file that git doesn't ignore. It also saves the conversation's Claude Code session. A run in a container that has slept restores both, so a later run in the same conversation and worktree resumes its session. The rest of `/data` is lost, such as ignored files like `node_modules`, and files outside the worktrees. The container doesn't snapshot its disk |
| The runner runs only Claude Code | The runner passes an agent's `model`, `effort`, `systemPrompt` and `settings` to `claude -p`, and posts its final message as the reply. It doesn't write an agent's `files`. `factory container ssh` doesn't exist yet |
| A changed Railway secret reaches a service only when the service redeploys | Railway resolves a `${{shared.<name>}}` reference when it deploys the service. Writing a new value to the sealed variable doesn't redeploy the router or deployer |
