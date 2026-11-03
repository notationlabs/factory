# `@lightbox/railway`

`@lightbox/railway` runs the lightbox hub (`Vault`, `Router` and `Deployer`) and repository outposts inside a shared Railway project with persistent `/data` volumes and private networking. Imported in `lightbox.infra.ts` from `@lightbox/railway`.

```bash
@pm.dev("@lightbox/railway")
```

## Vault, Router & Deployer

Provision the hub and outpost builder in a Railway project:

```ts [lightbox.infra.ts]
import { lightbox, secret } from "lightbox";
import * as claude from "@lightbox/claude";
import * as railway from "@lightbox/railway";

export default lightbox(() => {
  const vault = new railway.Vault("vault"); // <-- sealed variables; left by `lightbox infra down`

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
| `railway.Router` | `acme-agents` Railway project + public `lightbox-router` service with `/data` volume and webhook domain. Its config is a file on that volume (`/data/config.json`). It generates `LIGHTBOX_ROOT_KEY` into the vault |
| `railway.Deployer` | Private, scale-to-zero `lightbox-deployer` service inside `acme-agents`, and a project token of its own to manage outpost services. It writes each account's secrets to the vault |

## Environment variables

| Variable | Purpose |
| --- | --- |
| `RAILWAY_API_TOKEN` | Authenticates `lightbox infra up` and `lightbox infra down` |
