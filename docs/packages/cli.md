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

After the hub is created, the CLI never reads a hub secret. See [Secrets](../manual/secrets.md).

## `factory.config.ts`

Load local credentials for every command:

```ts [factory.config.ts]
export default {
  loadEnv: "./with-env.sh",
};
```

Read from the infrastructure repository root before any `factory` command runs:

| Field | Behavior |
| --- | --- |
| `loadEnv` | Command prefix run once at startup; `factory` adopts the environment it sets before pre-flight checks |
