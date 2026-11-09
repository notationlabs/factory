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

In each outpost repository, add `@notation/factory` and the plugins `.factory/config.ts` uses:

```bash
@pm.dev("@notation/factory @notation/factory-github @notation/factory-claude")
```

| Package | Used in |
| --- | --- |
| [`@notation/factory`](../packages/core.md) | Both |
| [`@notation/factory-cloudflare`](../packages/cloudflare.md) | `factory.infra.ts` |
| [`@notation/factory-railway`](../packages/railway.md) | `factory.infra.ts` |
| [`@notation/factory-github`](../packages/github.md) | Both |
| [`@notation/factory-slack`](../packages/slack.md) | Both |
| [`@notation/factory-claude`](../packages/claude.md) | Both |

## Prerequisites

Some plugins need a vendor CLI on your machine, signed in:

| Plugin | Requires | Sign in |
| --- | --- | --- |
| `@notation/factory-github` | `gh` | `gh auth login` |
| `@notation/factory-claude` | `claude`, for the `CLAUDE_CODE_OAUTH_TOKEN` its `Account` reads | `claude setup-token` |
| `@notation/factory-cloudflare` | `npx wrangler@4` | `npx wrangler login` |
| `@notation/factory-railway` | `railway`, for `factory container ssh` and `resume` | `railway login` |
