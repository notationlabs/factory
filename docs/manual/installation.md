# Installation

## CLI

Install the `lightbox` CLI globally from npm:

```bash
@pm.add("-g @lightbox/cli")
```

The CLI runs on [Bun](https://bun.sh), which must be on your `PATH`.

## Packages

In your infrastructure repository, add `lightbox` and the plugins `lightbox.infra.ts` uses:

```bash
@pm.dev("lightbox @lightbox/cloudflare @lightbox/github @lightbox/claude")
```

In each outpost repository, add `lightbox` and the plugins `.lightbox/config.ts` uses:

```bash
@pm.dev("lightbox @lightbox/github @lightbox/claude")
```

| Package | Used in |
| --- | --- |
| [`lightbox`](../packages/core.md) | Both |
| [`@lightbox/cloudflare`](../packages/cloudflare.md) | `lightbox.infra.ts` |
| [`@lightbox/railway`](../packages/railway.md) | `lightbox.infra.ts` |
| [`@lightbox/github`](../packages/github.md) | Both |
| [`@lightbox/slack`](../packages/slack.md) | Both |
| [`@lightbox/claude`](../packages/claude.md) | Both |

## Prerequisites

Some plugins need a vendor CLI on your machine, signed in:

| Plugin | Requires | Sign in |
| --- | --- | --- |
| `@lightbox/github` | `gh` | `gh auth login` |
| `@lightbox/claude` | `claude`, for the `CLAUDE_CODE_OAUTH_TOKEN` its `Account` reads | `claude setup-token` |
| `@lightbox/cloudflare` | `npx wrangler@4` | `npx wrangler login` |
| `@lightbox/railway` | `railway`, for `lightbox container ssh` and `resume` | `railway login` |
