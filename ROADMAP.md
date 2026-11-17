# Roadmap

A temporary list of the work that's left. Delete it once the list is empty, or once issues track the work.

## Done

- [x] **Keep worktrees and sessions across container sleeps.** After each run, the runner saves the worktree as a git bundle and the Claude session to R2, through the `state.factory` host that the container's Durable Object answers. Tested live: a new container restored the untracked file and the session. The runner also handles SIGTERM now, since as PID 1 it ignored the signal and containers never slept.
- [x] **Refresh GitHub tokens during long runs.** Each run carries a ticket that the router signed. Every 30 minutes while the agent runs, the runner posts it to the router's `/tokens` route and writes the new tokens to `/data/github/`. Git's credential helper and a `gh` shim read the run's token from the file that `FACTORY_TOKEN_FILE` names, so agents no longer get `GH_TOKEN`. Not yet tested live.
- [x] **Pin containers to `WEUR`.** Notation 0.28.0 passes `constraints` through `$durableObject`'s container. `cloudflare.Deployer` takes a `regions` option, and the example hub sets `["WEUR"]`. Tested live: the container ran in Düsseldorf.

## Now

Nothing. Pick from Next.

## Next

- [ ] **Stage 2: build each repo's outpost image with Workers Builds.** Workers Builds builds the repo's `.factory/Dockerfile`, or the default Dockerfile when the repo has none, so `factory infra up` no longer builds the outpost image with local Docker. Until then it does, and a slow uplink makes the first push take a long time. notationlabs/notation#175 asks for prebuilt images in `$durableObject`, which Factory won't use for now. Workers Builds builds from a Cloudflare Artifacts repo, so no forge needs Cloudflare's app. For each outpost container, the deploy:
  1. Pushes the repo's checkout and the generated files, such as the wrangler config, to an Artifacts repo. The production branch must be `main`.
  2. Creates a Worker script, then its build config with `POST /builds/workers` and `provider_type: "cloudflare_artifacts"`. A container application belongs to one Durable Object namespace, so each container needs its own Worker and container name.
  3. Starts a build, which builds the Dockerfile, pushes the image to the account's registry and runs `wrangler deploy`.

  The Workers Builds API rejects account tokens, so the deploy needs a user token with Workers CI and Artifacts permissions. The deploy opens the dashboard's create-token page with the permissions filled in, and registers the token as the build token. Tested live: a Dockerfile builds in Workers Builds, and the API connects an Artifacts repo. `cloudflare_artifacts` isn't in the documented enum, and `PUT /builds/repos/connections` rejects it with 12065.

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
- [ ] **CLI:**
  - Add `factory container ssh`.
  - Have `factory infra down` open the GitHub App's settings page, as the docs say. It only prints the link today.
- [ ] **GitHub:** adopt an existing App by its slug, so a recreated hub keeps the App and its installations. GitHub returns a private key only when it creates an App, so adoption needs a key that you generate on the App's settings page.
- [ ] **Notation:** let a Worker's bindings take contributions, or add a bundle resource, so the router can drop its own build script.
- [ ] **Railway:** no work planned. The stubs stay, and a changed secret reaches a service only when the service redeploys.
