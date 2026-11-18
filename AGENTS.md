# Notation Factory

Notation Factory runs coding agents in remote containers. See `README.md` for the hub and outpost model, and `docs/manual/` for how each part works.

## Layout

- `packages/factory`: the contracts, the router, the deployer's SDK and the runner that runs in containers.
- `packages/<plugin>`: each plugin's implementation of the contracts, such as `cloudflare`, `github`, `claude` and `droid`.
- `packages/cli`: the `factory` CLI.
- `docs/manual` and `docs/reference`: the user docs.
- `examples/`: a test hub and outpost.
- `.factory/`: this repo's own outpost.
- `ROADMAP.md`: the work that's left.

The packages ship their TypeScript source. The only builds are the SDK and the outpost Worker, which `pnpm test` runs first.

## Checks

Run both before you open a pull request, and say in the pull request if either fails:

```bash
pnpm install --filter '!@notation/factory-docs-site'
pnpm typecheck
pnpm test
```

The docs site depends on a private repo over SSH, which outpost containers can't clone, and neither check needs it.

Tests use `node:test` and sit next to the code they test, as `*.test.ts`.

## Conventions

- Match the code around your change. Keep comments for the reasons the code can't show.
- When a change alters behaviour that the docs describe, update `docs/manual` or `docs/reference` in the same pull request.
- Write docs and commit messages in short, plain sentences. A commit message states the new behaviour, such as "Droid's runtime setup installs procps when the image has no ps".
- Don't edit `ROADMAP.md`'s Done section unless you finished one of its items.
