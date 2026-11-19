# Container Providers

A Notation Factory hub runs its `Router`, `Deployer`, and every outpost `Container` on one provider plugin, such as `@notation/factory-cloudflare`. `.factory/infra.ts` stays provider-agnostic, so you can switch providers in `factory.infra.ts` without touching subscriber repositories.

| Capability | Cloudflare (`@notation/factory-cloudflare`) | Railway (`@notation/factory-railway`) |
| --- | --- | --- |
| **Compute** | Workers for the router, the deployer and each connection's channel, and an outpost Worker per container, which hosts one container of the container's `instanceType`, or `standard-1` | Railway Service per router, deployer, and outpost |
| **Private network** | Authenticated Worker routing (`*.factory.internal`) | Railway private network (`*.railway.internal`) |
| **Service store** | Durable Object storage | JSON files on `/data` volume |
| **Vault** | `cloudflare.Vault` (Secrets Store) | `railway.Vault` (sealed shared variables) |
| **Outpost `/data` disk** | The container's disk; the runner saves worktrees and sessions to R2 after each run | Railway persistent volume at `/data` |
| **Image builds** | Workers Builds, from an Artifacts repo per container | Railway GitHub builder |
| **Container SSH** | `wrangler containers ssh` | `railway ssh` (`railway login`) |

The vault is always on the hub's provider: `cloudflare.Router` and `cloudflare.Deployer` take a `cloudflare.Vault`, and `railway.Router` and `railway.Deployer` take a `railway.Vault`. See [Secrets](./secrets.md).

## Cloudflare

Run the hub and outposts on Cloudflare Workers and Durable Object Containers:

```ts [factory.infra.ts]
// …
const vault = new cloudflare.Vault("vault");

const router = new cloudflare.Router("router", { vault });

new cloudflare.Deployer("deployer", {
  router,
  vault,
  accounts: [claudeAccount],
  accountId: "<account id>", // <-- optional; defaults to CLOUDFLARE_ACCOUNT_ID
  regions: ["WEUR"], // <-- optional; where outpost containers may run
  sleepAfter: "10m", // <-- optional; how long an idle container stays up
});
```

| Credential | Used by | Setup |
| --- | --- | --- |
| **Local sign-in** | `factory infra up` and `factory infra down` (KV, R2, Secrets Store, Workers, Artifacts, API tokens) | `npx wrangler login`, or `CLOUDFLARE_API_TOKEN`. Deploy creates and deletes the Artifacts namespace with `CLOUDFLARE_API_TOKEN`, so it needs Artifacts Edit. `factory infra down` also deletes the outpost Workers and their container applications with it, so it needs Workers Scripts Edit and Containers Edit too |
| **Builds token** | The deployer, which creates each outpost Worker, its Artifacts repo and its build config | A user API token, since the Workers Builds API refuses account tokens. The first `factory infra up` opens a local page that links to Cloudflare's create-token page, filled in with the token's seven permissions, and takes the token you paste. Its value goes to a Secrets Store secret |

The router's KV namespace holds the router's config and other non-secret values. The router's config names each connection's secrets by their binding names, and holds no secret values. Secrets are only in the Secrets Store or in Worker secrets.

Each container in each repo gets an outpost Worker of its own, such as `…-deployer-outpost-3c935fa1d678` for `dev` in `acme/webapp`:

| Step | What happens |
| --- | --- |
| **Deploy** | The deployer commits the container's source to an Artifacts repo of the same name. Workers Builds builds the image and deploys the outpost Worker. See [Containers](./containers.md#builds) |
| **Run** | The deployer posts the run to the outpost Worker's workers.dev URL, signed with a key derived from the root key. The outpost Worker checks the signature with the deployer, and hands the run to its container |
| **Credentials and state** | The outpost Worker binds the deployer as a service, and asks it for the run's credentials and for the saved worktrees and sessions. So outpost Workers hold no secrets |

## Railway

Run the hub and outposts as services inside a Railway project:

```ts [factory.infra.ts]
// …
const vault = new railway.Vault("vault");

const router = new railway.Router("router", { vault });

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

Railway builds `.factory/Dockerfile` through its own GitHub App, **Railway App**. Cloudflare needs no builder access, because the deployer commits `.factory/` to Artifacts itself:

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
| The deployer doesn't check configs | An install, or a push to the default branch, has the router read `.factory/` through the GitHub channel. The deployer evaluates it with the Worker Loader and stores the outpost config, and the router writes `FACTORY_STATUS`. The deployer doesn't run the checks in [Outposts](./outposts.md#subscribing--deploys) |
| A container keeps only its worktrees and sessions while it sleeps | After each run, the runner saves the run's worktree to R2 as a git bundle, with every file that git doesn't ignore. It also saves the session of the run's agent, which is separate from other agents' sessions in the conversation. A run in a container that has slept restores both, so a later run of the same agent in the same conversation and worktree resumes its session. The rest of `/data` is lost, such as ignored files like `node_modules`, and files outside the worktrees. The container doesn't snapshot its disk |
| The runner runs Claude Code, Cursor Agent and Droid | The runner passes a Claude agent's `model`, `effort`, `systemPrompt` and `settings` to `claude -p`, a Cursor agent's to `agent -p`, and a Droid agent's to `droid exec`, and posts the final message as the reply. For Claude, Cursor and Droid agents, it also posts each message during the run, in place of the last. It doesn't write an agent's `files`. `factory container ssh` doesn't exist yet |
| A changed Railway secret reaches a service only when the service redeploys | Railway resolves a `${{shared.<name>}}` reference when it deploys the service. Writing a new value to the sealed variable doesn't redeploy the router or deployer |
