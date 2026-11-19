# `@notation/factory-cli`

`@notation/factory-cli` provides the `factory` executable. It runs on [Bun](https://bun.sh):

```bash
@pm.add("-g @notation/factory-cli")
```


| Command group | Purpose |
| --- | --- |
| `factory infra *` | Reconcile `factory.infra.ts` and inspect deliveries |
| `factory repo *` | Subscribe repositories and inspect `FACTORY_STATUS` |
| `factory container *` | Attach to remote outpost containers (`resume`, `ssh`) |

See [CLI Reference](../manual/cli.md) for all commands and flags.

## Credentials

The CLI has two kinds of credential, with separate jobs:

| Credential | Used for |
| --- | --- |
| **Local provider credentials** (Wrangler login or `CLOUDFLARE_API_TOKEN`; `RAILWAY_API_TOKEN`; `gh`; account secrets such as `CLAUDE_CODE_OAUTH_TOKEN`) | The hub's lifecycle: `factory infra up` and `factory infra down` create, update and delete it, and write secrets to its vault |
| **Operator auth** (`github.OperatorAuth` or `cloudflare.OperatorAuth`) | Everything that talks to the running hub: `factory infra status`, `factory infra replay`, and the router calls `up` and `down` make |

The CLI keeps each hub's admin session in `~/.config/notation-factory/sessions.json` until it expires, after 4 hours. The CLI never reads a hub secret back. Deploy writes each secret's value from a credential: a source, such as an environment variable, or the resource that issued it, such as a GitHub App. See [Secrets](../manual/secrets.md).

## `factory.config.ts`

Load local credentials for every command:

```ts [factory.config.ts]
export default {
  loadEnv: "./with-env.sh",
  router: "https://acme--prod--router-1a2b3c4d.acme.workers.dev",
};
```

Read from the infrastructure repository root before any `factory` command runs:

| Field | Behavior |
| --- | --- |
| `loadEnv` | Command prefix run once at startup; `factory` adopts the environment it sets before pre-flight checks |
| `router` | The URL of the hub's router, which `factory infra status` and `factory infra replay` call. `factory infra up` prints it when it creates the router |

## `.factory/config.ts`

Name the hub that an outpost subscribes to:

```ts [.factory/config.ts]
export default {
  hub: { app: "acme", stage: "prod" },
  repo: "acme/webapp",
};
```

Read by the `factory repo` commands, beside `.factory/infra.ts`. The deployer doesn't read it:

| Field | Behavior |
| --- | --- |
| `hub` | The hub's Notation app and stage, which name its GitHub Apps. `factory repo install` needs it |
| `repo` | The outpost's repo, as `owner/name`, when the `origin` remote doesn't name it |
