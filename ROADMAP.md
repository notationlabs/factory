# Roadmap

A temporary list of the work that's left. Delete it once the list is empty, or once issues track the work.

## Done

- [x] **Build each repo's outpost image with Workers Builds.** Each container gets an outpost Worker of its own. The deployer commits the container's `.factory/` to an Artifacts repo with `isomorphic-git`, and Workers Builds builds the image and deploys the Worker. The image holds nothing from Factory: its entrypoint fetches the runner from the outpost Worker. `factory infra up` takes the builds token, a user API token, on a local page. Tested live: a push built the example's `.factory/Dockerfile`, and Claude replied to a mention. See [Containers](docs/manual/containers.md#image) and [Providers](docs/manual/providers.md#cloudflare).
- [x] **Keep worktrees and sessions across container sleeps.** After each run, the runner saves the worktree as a git bundle and the Claude session to R2, through the `state.factory` host that the container's Durable Object answers. Tested live: a new container restored the untracked file and the session. The runner also handles SIGTERM now, since as PID 1 it ignored the signal and containers never slept.
- [x] **Refresh GitHub tokens during long runs.** Each run carries a ticket that the router signed. Every 30 minutes while the agent runs, the runner posts it to the router's `/tokens` route and writes the new tokens to `/data/github/`. Git's credential helper and a `gh` shim read the run's token from the file that `FACTORY_TOKEN_FILE` names, so agents no longer get `GH_TOKEN`. Not yet tested live.
- [x] **Pin containers to `WEUR`.** Notation 0.28.0 passes `constraints` through `$durableObject`'s container. `cloudflare.Deployer` takes a `regions` option, and the example hub sets `["WEUR"]`. Tested live: the container ran in Düsseldorf.
- [x] **Let containers sleep.** The deployer didn't read the runner's reply to a delivered run, and `@cloudflare/containers` counts a request as in flight until its body is read, so containers never slept. Tested live: the container stopped 10 minutes after the run's delivery. `cloudflare.Deployer`'s `sleepAfter` option sets that time for every outpost container, and defaults to `"10m"`.

## Now

- [ ] **Show outpost builds on GitHub.** Built, not yet tested live. Each container's build is a check on the pushed commit, such as `factory/build dev`.
  - After a deploy, the router writes a queued check for each container whose image started building.
  - The deployer's `BuildWatch` Durable Object polls the Builds API every 30 seconds for the build of the commit it pushed. It posts signed reports to the router's `/builds` route, which updates the check with the build's state and log link.
  - A failed build clears the source's hash, so the next push builds it again.
  - The App gets `checks: write`. Deploy opens the App's permissions page, since GitHub has no API for it, and each installation accepts the change.
  - To test: the build log link's URL, and the build's `commit_hash` for an Artifacts repo, which the watch matches on.

## Next

- [ ] **Stage 2 follow-ups:**
  - `factory infra down` deletes the Artifacts repos, but not the outpost Workers or their container applications.
  - Notation needs a public way to refer to a `worker()`'s generated name. The deployer reads Notation's internal registration for it.
  - Remove the deployer's account token, and its `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `KNOWN_HOSTS` bindings. The deployer Worker reads none of them.

## Later

- [ ] **Router:**
  - Check `github.team(...)` in a trigger's `from`.
  - Mint tokens for custom `Policy` types, not only `github.Policy`.
  - Implement the channel contract for Slack.
- [ ] **Deliveries:** the old prototype had these, and Factory doesn't yet:
  - An inbox that saves each delivery before answering.
  - De-duplication by delivery id.
  - A queue of failed deliveries, with replay.
- [ ] **Deployer:**
  - Run the checks in `docs/manual/outposts.md#subscribing--deploys` before storing an outpost config.
  - Once Notation has queues, watch builds through a queue of Workers Builds events instead of the `BuildWatch` alarm. Events carry the build's uuid and arrive within seconds, so the deployer no longer polls or matches commit hashes. The deployer subscribes each outpost Worker when it creates it, and maps each Artifacts commit to its repo, commit and container in KV. A build that never starts still needs a timeout.
- [ ] **Runner:**
  - Write an agent's `files`.
  - Support runtimes other than Claude Code.
- [ ] **CLI:**
  - Add `factory container ssh`.
  - Have `factory infra down` open the GitHub App's settings page, as the docs say. It only prints the link today.
- [ ] **GitHub:** adopt an existing App by its slug, so a recreated hub keeps the App and its installations. GitHub returns a private key only when it creates an App, so adoption needs a key that you generate on the App's settings page.
- [ ] **Notation:** let a Worker's bindings take contributions, or add a bundle resource, so the router can drop its own build script.
- [ ] **Railway:** no work planned. The stubs stay, and a changed secret reaches a service only when the service redeploys.
