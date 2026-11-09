# `@factory/railway`

`@factory/railway` runs the Notation Factory hub (`Vault`, `Router` and `Deployer`) and repository outposts inside a shared Railway project with persistent `/data` volumes and private networking. Imported in `factory.infra.ts` from `@factory/railway`.

```bash
@pm.dev("@factory/railway")
```

## Vault, Router & Deployer

Provision the hub and outpost builder in a Railway project:

```ts [factory.infra.ts]
import { factory, secret } from "factory";
import * as claude from "@factory/claude";
import * as railway from "@factory/railway";

export default factory(() => {
  const vault = new railway.Vault("vault"); // <-- sealed variables; left by `factory infra down`

  const router = new railway.Router("router", {
    project: "acme-agents", // <-- Railway project name
    vault,                  // <-- only a railway.Vault
  });

  const claudeAccount = new claude.Account("claude", { auth: secret.env("CLAUDE_CODE_OAUTH_TOKEN") });

  new railway.Deployer("deployer", {
    router,
    vault,
    accounts: [claudeAccount],
  });
});
```

| Resource | Railway resources provisioned |
| --- | --- |
| `railway.Vault` | Sealed shared variables in the router's project. Values are never shown in the dashboard or returned by the API. The router binds it to its project, so pass it to a `railway.Router` before anything adds a secret to it |
| `railway.Router` | `acme-agents` Railway project + public `factory-router` service with `/data` volume and webhook domain. Its config is a file on that volume (`/data/config.json`). It generates `FACTORY_ROOT_KEY` into the vault |
| `railway.Deployer` | Private, scale-to-zero `factory-deployer` service inside `acme-agents`, and a project token of its own to manage outpost services. It writes each account's secrets to the vault |

## Environment variables

| Variable | Purpose |
| --- | --- |
| `RAILWAY_API_TOKEN` | Authenticates `factory infra up` and `factory infra down` |
