# Roadmap

A temporary list of the work that's left. Delete it once the list is empty, or once issues track the work.

## Done

- [x] **Keep worktrees and sessions across container sleeps.** After each run, the runner saves the worktree as a git bundle and the Claude session to R2, through the `state.factory` host that the container's Durable Object answers. Not yet tested live.

## Now

- [ ] **Refresh GitHub tokens during long runs.** Installation tokens expire after an hour, and the router mints them once per run. The runner asks the router for a new token before the old one expires.

## Next

- [ ] **Pin containers to `WEUR`.** Cloudflare starts a container wherever the image is pre-fetched, and the first one ran in Delhi. Waits on notationlabs/notation#172: `constraints` on `$durableObject`'s container and on `ContainerApplication`. Then `cloudflare.Deployer` takes a `regions` option, and the example hub sets `["WEUR"]`.
- [ ] **Build images off the local machine.** `factory infra up` builds the hub image with local Docker, and a slow uplink makes the first push take a long time. Options:
  - Workers Builds builds and pushes the image. It needs Cloudflare's Git integration on the hub's repo. It also needs `$durableObject` to accept an image reference, or Factory has to declare the `ContainerApplication` itself.
  - A prebuilt image that CI pushes on release. It needs a Docker Hub organisation.
- [ ] **Stage 2: build each repo's `.factory/Dockerfile`.** This goes through Workers Builds and needs:
  - Cloudflare's GitHub App installed on every subscribed repo.
  - A user-scoped API token. The Workers Builds API rejects account tokens, and the deployer's token is an account token.
  - A Worker script and a container application for each outpost container, because a container application belongs to one Durable Object namespace.
  - A build command that generates the wrangler config inside the build.

  Until then, `FACTORY_STATUS` should say the Dockerfile is ignored.

## Later

- [ ] **Router:**
  - Check `github.team(...)` in a trigger's `from`.
  - Mint tokens for custom `Policy` types, not only `github.Policy`.
  - Implement the channel contract for Slack.
- [ ] **Deliveries:** the old prototype had these, and Factory doesn't yet:
  - An inbox that saves each delivery before answering.
  - De-duplication by delivery id.
  - A queue of failed deliveries, with replay.
- [ ] **Deployer:** run the checks in `docs/manual/outposts.md#subscribing--deploys` before storing an outpost config.
- [ ] **Runner:**
  - Write an agent's `files`.
  - Support runtimes other than Claude Code.
- [ ] **CLI:** add `factory container ssh`.
- [ ] **Notation:** let a Worker's bindings take contributions, or add a bundle resource, so the router can drop its own build script.
- [ ] **Railway:** no work planned. The stubs stay, and a changed secret reaches a service only when the service redeploys.
