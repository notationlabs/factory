# Installation

Install the Notation Factory CLI globally, then add the Factory core and plugin packages to your hub and outpost repositories.

## CLI

Install `@notation/factory-cli` globally:

```bash [Terminal]
@pm.add("-g @notation/factory-cli")
```

The `factory` CLI runs on [Bun](https://bun.sh), which must be available on your `PATH`.

## Hub packages

In your infrastructure repository (`factory.infra.ts` and `notation.config.ts`), install Notation, the core package, and the plugins your hub uses:

```bash [Terminal]
@pm.dev("@notation/cli @notation/core @notation/std @notation/factory @notation/factory-cloudflare @notation/factory-github @notation/factory-claude")
```

Add `@notation/factory-cursor` or `@notation/factory-droid` if your hub also provides accounts for Cursor Agent or Droid.

## Outpost packages

In each repository that declares `.factory/infra.ts`, install `@notation/factory` alongside its GitHub and agent plugins:

```bash [Terminal]
@pm.dev("@notation/factory @notation/factory-github @notation/factory-claude")
```

Outpost repositories do not import `@notation/factory-cloudflare`, keeping repository config independent of the hub's hosting provider.

## Package summary

Each package belongs to the hub, to outposts, or to both:

| Package | Used in |
| :--- | :--- |
| `@notation/factory` | Hub and outposts |
| `@notation/factory-cli` | Operator workstation |
| `@notation/factory-cloudflare` | Hub |
| `@notation/factory-github` | Hub and outposts |
| `@notation/factory-claude` | Hub and outposts |
| `@notation/factory-cursor` | Hub and outposts |
| `@notation/factory-droid` | Hub and outposts |

## Prerequisites

Deploying a hub and subscribing repositories require local authentication for each active plugin:

| Plugin | Requirement |
| :--- | :--- |
| `@notation/factory-github` | Authenticated `gh` CLI session or `GH_TOKEN` |
| `@notation/factory-cloudflare` | `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` environment variables |
| `@notation/factory-claude` | `CLAUDE_CODE_OAUTH_TOKEN` generated via `claude setup-token` |
| `@notation/factory-cursor` | `CURSOR_API_KEY` from the Cursor dashboard |
| `@notation/factory-droid` | `FACTORY_API_KEY` from Factory account settings |

See [Cloudflare Provider](./cloudflare.md) for the Cloudflare token permissions required when deploying and tearing down a hub.
