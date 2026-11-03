# `@lightbox/cli`

`@lightbox/cli` provides the `lightbox` executable. It runs on [Bun](https://bun.sh):

```bash
@pm.add("-g @lightbox/cli")
```


| Command group | Purpose |
| --- | --- |
| `lightbox infra *` | Reconcile `lightbox.infra.ts` and inspect deliveries |
| `lightbox repo *` | Subscribe repositories and inspect `LIGHTBOX_STATUS` |
| `lightbox container *` | Attach to remote outpost containers (`resume`, `ssh`) |

See [CLI Reference](../manual/cli.md) for all commands and flags.

## Credentials

The CLI has two kinds of credential, with separate jobs:

| Credential | Used for |
| --- | --- |
| **Local provider credentials** (Wrangler login or `CLOUDFLARE_API_TOKEN`; `RAILWAY_API_TOKEN`; `gh`; account secrets such as `CLAUDE_CODE_OAUTH_TOKEN`) | The hub's lifecycle: `lightbox infra up` and `lightbox infra down` create, update and delete it, and write secrets to its vault |
| **Operator auth** (`github.OperatorAuth` or `cloudflare.OperatorAuth`) | Everything that talks to the running hub: `lightbox infra status`, `lightbox infra replay`, and the router calls `up` and `down` make |

After the hub is created, the CLI never reads a hub secret. See [Secrets](../manual/secrets.md).

## `lightbox.config.ts`

Load local credentials for every command:

```ts [lightbox.config.ts]
export default {
  loadEnv: "./with-env.sh",
};
```

Read from the infrastructure repository root before any `lightbox` command runs:

| Field | Behavior |
| --- | --- |
| `loadEnv` | Command prefix run once at startup; `lightbox` adopts the environment it sets before pre-flight checks |
