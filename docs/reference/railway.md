# `@notation/factory-railway`

Declares Notation Factory hub wiring targeting Railway projects, services, volumes, and sealed shared variables.

## Status

`@notation/factory-railway` is currently incomplete and cannot deploy or run a live hub:

- All underlying Railway API functions in `packages/railway/lib/railway.ts` throw `"not implemented"`.
- `Router.channel(...)` throws because the Railway router service implementation does not exist yet.
- `OutpostSecret` binding and `OperatorAuth` are not implemented for Railway.

Use [`@notation/factory-cloudflare`](./cloudflare.md) for live deployments.

## Exported classes and options

```ts [@notation/factory-railway]
new railway.Vault(id: string);
new railway.Router(id: string, options: { vault: Vault });
new railway.Deployer(id: string, options: { router: Router; vault: Vault; accounts?: Account[] });
```

| Export | Description |
| :--- | :--- |
| `Vault` | Sealed variable tracker with `provider` set to `"railway"`, bound by `railway.Router` |
| `Router` | Declares project, 32-byte `RandomKey`, `/data` volume, and `/data/config.json` |
| `Deployer` | Declares project token, sleeping deployer service, `RAILWAY_TOKEN`, and account secrets |
