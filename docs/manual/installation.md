# Installation

## CLI

Install the `factory` CLI globally from npm:

```bash
@pm.add("-g @notation/factory-cli")
```

The CLI runs on [Bun](https://bun.sh), which must be on your `PATH`.

## Packages

In your infrastructure repository, add `@notation/factory` and the plugins `factory.infra.ts` uses:

```bash
@pm.dev("@notation/factory @notation/factory-cloudflare @notation/factory-github @notation/factory-claude")
```

In each outpost repository, add `@notation/factory` and the plugins `.factory/infra.ts` uses:

```bash
@pm.dev("@notation/factory @notation/factory-github @notation/factory-claude")
```

| Package | Used in |
| --- | --- |
| [`@notation/factory`](../reference/core.md) | Both |
| [`@notation/factory-cloudflare`](../reference/cloudflare.md) | `factory.infra.ts` |
| [`@notation/factory-railway`](../reference/railway.md) | `factory.infra.ts` |
| [`@notation/factory-github`](../reference/github.md) | Both |
| [`@notation/factory-slack`](../reference/slack.md) | Both |
| [`@notation/factory-claude`](../reference/claude.md) | Both |
| [`@notation/factory-droid`](../reference/droid.md) | Both |

## Prerequisites

Some plugins need a vendor CLI on your machine, signed in:

| Plugin | Requires | Sign in |
| --- | --- | --- |
| `@notation/factory-github` | `gh` | `gh auth login` |
| `@notation/factory-claude` | `claude`, for the `CLAUDE_CODE_OAUTH_TOKEN` its `Account` reads | `claude setup-token` |
| `@notation/factory-droid` | `droid`, for the `FACTORY_API_KEY` its `Account` reads | An API key from the [Factory settings page](https://app.factory.ai/settings/api-keys) |
| `@notation/factory-cloudflare` | `npx wrangler@4` | `npx wrangler login` |
| `@notation/factory-railway` | `railway`, for `factory container ssh` and `resume` | `railway login` |
