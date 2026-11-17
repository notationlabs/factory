# `@notation/factory-railway`

`@notation/factory-railway` runs the Notation Factory hub (`Vault`, `Router` and `Deployer`) and repository outposts inside a shared Railway project with persistent `/data` volumes and private networking. Imported in `factory.infra.ts` from `@notation/factory-railway`.

```bash
@pm.dev("@notation/factory-railway")
```

## Vault, Router & Deployer

Provision the hub and outpost builder in a Railway project:

```ts [factory.infra.ts]
import * as claude from "@notation/factory-claude";
import * as railway from "@notation/factory-railway";
import { sources } from "@notation/std/resources";

const vault = new railway.Vault("vault"); // <-- sealed shared variables in the router's project

const router = new railway.Router("router", {
  project: "acme-agents", // <-- Railway project name
  vault,                  // <-- only a railway.Vault
});

const claudeToken = new sources.Env("claude-oauth-token", {
  config: { key: "CLAUDE_CODE_OAUTH_TOKEN", track: "scrypt" },
});
const claudeAccount = new claude.Account("claude", {
  auth: vault.secret({ id: "claude-oauth-token", value: claudeToken.credentials.value }),
});

new railway.Deployer("deployer", {
  router,
  vault,
  accounts: [claudeAccount],
});
```

| Resource | Railway resources provisioned |
| --- | --- |
| `railway.Vault` | One sealed shared variable in the router's project for each secret declared in the vault. Values are never shown in the dashboard or returned by the API. The router gives it its project, so pass it to a `railway.Router` before anything adds a secret to it |
| `railway.Router` | `acme-agents` Railway project + public `factory-router` service with `/data` volume and webhook domain. Its config is a file on that volume (`/data/config.json`). It generates `router.rootKey` with a `RandomKey`, keeps it in the vault, and binds it as `FACTORY_ROOT_KEY`. `router.bind(secret, name?)` adds a variable to the router service |
| `railway.Deployer` | Private, scale-to-zero `factory-deployer` service inside `acme-agents`, and a project token of its own to manage outpost services. It keeps the token in the vault and binds it as `RAILWAY_TOKEN`. Railway has no API that gives a token a new value, so when deploy needs the value again, plan fails and asks for a token with `--credential`. It binds `router.rootKey` as `FACTORY_ROOT_KEY`, and each account's secrets under their env var names, such as `CLAUDE_CODE_OAUTH_TOKEN` |

## Secrets

Each secret in the vault is a sealed shared variable named `<app>__<stage>__<id>`, with each character other than a letter, a digit or `_` replaced by `_`. For example, the root key of the `prod` stage of an app named `acme` is `acme__prod__router_root_key`. Two secret ids that map to the same name, such as `a-b` and `a_b`, are rejected, and so is a second secret with the same id.

The router and deployer services each get one variable for every secret they bind. The variable is named after the binding name, and its value is a reference to the sealed variable:

```text
FACTORY_ROOT_KEY = ${{shared.acme__prod__router_root_key}}
```

Railway resolves the reference when it deploys the service. So a changed secret reaches a service only when the service redeploys. See [Known gaps](../manual/providers.md#known-gaps).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `RAILWAY_API_TOKEN` | Authenticates `factory infra up` and `factory infra down` |
