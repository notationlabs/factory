# Installation

## CLI

Install the `factory` CLI globally from npm:

```bash
@pm.add("-g @factory/cli")
```

The CLI runs on [Bun](https://bun.sh), which must be on your `PATH`.

## Packages

In your infrastructure repository, add `factory` and the plugins `factory.infra.ts` uses:

```bash
@pm.dev("factory @factory/cloudflare @factory/github @factory/claude")
```

In each outpost repository, add `factory` and the plugins `.factory/config.ts` uses:

```bash
@pm.dev("factory @factory/github @factory/claude")
```

| Package | Used in |
| --- | --- |
| [`factory`](../packages/core.md) | Both |
| [`@factory/cloudflare`](../packages/cloudflare.md) | `factory.infra.ts` |
| [`@factory/railway`](../packages/railway.md) | `factory.infra.ts` |
| [`@factory/github`](../packages/github.md) | Both |
| [`@factory/slack`](../packages/slack.md) | Both |
| [`@factory/claude`](../packages/claude.md) | Both |

## Prerequisites

Some plugins need a vendor CLI on your machine, signed in:

| Plugin | Requires | Sign in |
| --- | --- | --- |
| `@factory/github` | `gh` | `gh auth login` |
| `@factory/claude` | `claude`, for the `CLAUDE_CODE_OAUTH_TOKEN` its `Account` reads | `claude setup-token` |
| `@factory/cloudflare` | `npx wrangler@4` | `npx wrangler login` |
| `@factory/railway` | `railway`, for `factory container ssh` and `resume` | `railway login` |
