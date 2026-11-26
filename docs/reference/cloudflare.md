# `@notation/factory-cloudflare`

Runs a Notation Factory hub on Cloudflare Workers, Durable Objects, KV, R2, Secrets Store, Artifacts, and Cloudflare Containers.

## Exports

| Symbol | Description |
| :--- | :--- |
| `Vault` | Account Secrets Store manager class with `provider` set to `"cloudflare"` |
| `CloudflareSecret` | Single `SecretsStoreSecret` declaration class inside a `Vault` |
| `Router` | Hub router Worker, KV namespace, R2 bucket, and Durable Objects class |
| `Deployer` | Outpost evaluator, Artifacts builder, and container host manager class |
| `Service` | A hub service that a Worker runs, which containers reach at `http://<name>.factory` |
| `OperatorAuth` | Cloudflare Access resource group class, currently unimplemented at runtime |

## `Vault`

```ts [factory.infra.ts]
const vault = new cloudflare.Vault("vault");
const secret = vault.secret({ id: "token", value: envSource.credentials.value });
```

Declares or shares the account-wide Cloudflare Secrets Store (`cloudflare/Vault`).

## `Router`

```ts [factory.infra.ts]
const router = new cloudflare.Router("router", { vault });
```

Takes `{ vault: Vault }` and automatically attaches `RouterSync` on deploy.

| Member | Role |
| :--- | :--- |
| `url` | Public `OutputRef<string>` URL of the deployed router Worker |
| `kv` | Hub KV namespace storing outpost and router config |
| `bucket` | Hub R2 bucket storing container worktree bundles and session archives |
| `worker` | Deployed router Cloudflare Worker resource |
| `store` | KV JSON group holding `RouterConfig` |
| `rootKey` | Vault secret holding the 32-byte root key |
| `syncKey` | Vault secret holding the 32-byte deploy sync key |
| `bind(secret, name?)` | Binds a `VaultSecret` onto the router Worker and returns its binding name |
| `channel(options)` | Attaches a connection's channel Worker as a router service binding |
| `service(name, worker)` | Binds a hub service's Worker as `SERVICE_<name>` and records it in the router's `services` |

The router Worker exports a `ServiceGateway` entrypoint, which each outpost Worker binds as `ROUTER`. The entrypoint forwards each request to `<name>.factory` to the binding of the service `name`.

## `Deployer`

```ts [factory.infra.ts]
new cloudflare.Deployer("deployer", {
  router,
  vault,
  accounts: [claudeAccount],
  secrets: [dbSecret],
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  regions: ["WEUR"],
  sleepAfter: "10m",
});
```

| Option | Details |
| :--- | :--- |
| `router` | Required `cloudflare.Router` instance |
| `vault` | Required `cloudflare.Vault` instance |
| `accounts` | Optional `Account[]` array defaulting to `[]` |
| `secrets` | Optional `OutpostSecret[]` array defaulting to `[]`, must not collide on env name per repo |
| `accountId` | Optional Cloudflare account ID defaulting to `CLOUDFLARE_ACCOUNT_ID` |
| `regions` | Optional array from `ENAM`, `WNAM`, `EEUR`, `WEUR`, `APAC`, `SAM`, `ME`, `OC`, `AFR` |
| `sleepAfter` | Optional idle container duration matching `/^[1-9]\d*[smh]$/`, defaults to `"10m"` |

## `Service`

```ts [factory.infra.ts]
new cloudflare.Service("drafts", { router, worker: drafts });
```

| Option | Details |
| :--- | :--- |
| `router` | Required `cloudflare.Router` instance |
| `worker` | Required Notation `worker()` whose default export handles the containers' requests. Give it `url: false` |

The id is the service's name, which must pass `isServiceName`. The constructor throws on an invalid name and on a second service with the same name. See [Services](../authoring/services.md).

## `OperatorAuth` status

`new cloudflare.OperatorAuth(id, { router, emails })` declares Cloudflare Access configuration, but its Access operations in `packages/cloudflare/lib/access.ts` throw `"not implemented"` and the core router currently rejects non-GitHub operator sign-in with HTTP 501. Use `github.OperatorAuth` instead.

## Environment variables

| Variable | Required by |
| :--- | :--- |
| `CLOUDFLARE_ACCOUNT_ID` | `Deployer` when `accountId` option is omitted |
| `CLOUDFLARE_API_TOKEN` | Artifacts namespace and outpost Worker cleanup |

`CLOUDFLARE_API_TOKEN` requires `Artifacts Edit`, `Workers Scripts Edit`, and `Containers Edit` permissions.
