# Roadmap

A temporary list of the work that's left. Delete it once the list is empty, or once issues track the work.

## Done

- [x] **Keep worktrees and sessions across container sleeps.** After each run, the runner saves the worktree as a git bundle and the Claude session to R2, through the `state.factory` host that the container's Durable Object answers. Tested live: a new container restored the untracked file and the session. The runner also handles SIGTERM now, since as PID 1 it ignored the signal and containers never slept.
- [x] **Refresh GitHub tokens during long runs.** Each run carries a ticket that the router signed. Every 30 minutes while the agent runs, the runner posts it to the router's `/tokens` route and writes the new tokens to `/data/github/`. Git's credential helper and a `gh` shim read the run's token from the file that `FACTORY_TOKEN_FILE` names, so agents no longer get `GH_TOKEN`. Not yet tested live.
- [x] **Pin containers to `WEUR`.** Notation 0.28.0 passes `constraints` through `$durableObject`'s container. `cloudflare.Deployer` takes a `regions` option, and the example hub sets `["WEUR"]`. Tested live: the container ran in Düsseldorf.
- [x] **Let containers sleep.** The deployer didn't read the runner's reply to a delivered run, and `@cloudflare/containers` counts a request as in flight until its body is read, so containers never slept. Tested live: the container stopped 10 minutes after the run's delivery. `cloudflare.Deployer`'s `sleepAfter` option sets that time for every outpost container, and defaults to `"10m"`.

## Now

Nothing. Pick from Next.

## Next

- [ ] **Stage 2: build each repo's outpost image with Workers Builds.** So `factory infra up` no longer builds an image with local Docker, and a repo's `.factory/Dockerfile` takes effect. Until then, `FACTORY_STATUS` should say the Dockerfile is ignored.

  **Image contract:**
  - Built from `.factory/` with `.factory/Dockerfile`, or with Factory's default Dockerfile.
  - Holds Debian, `bun`, `git`, and the CLI of each runtime the container lists. Nothing from Factory.
  - `Runtime` loses `setup`. A repo's Dockerfile installs its runtimes itself.

  **At run time:**

  | What | How |
  | --- | --- |
  | Runner | The entrypoint fetches it from `runner.factory`, an outbound host that the outpost Worker answers from its bundle, and runs it with `bun` |
  | Runtimes | The runner checks each runtime's CLI at start, and fails the run if one is missing |
  | Credentials | Env vars at container start, as today |
  | Repo | Cloned on each run, as today |

  ```ts
  entrypoint = ["bun", "-e", `await Bun.write("/tmp/runner.js", await fetch("http://runner.factory/runner.js")); await import("/tmp/runner.js")`];
  ```

  **Deploy, per outpost container:**
  1. Commit `.factory/`, the default Dockerfile if needed, `wrangler.json` and the outpost Worker's bundle to an Artifacts repo, on `main`. The deployer writes the commit with `isomorphic-git`, as a root commit that it force-pushes.
  2. Create the outpost Worker, then its build config with `POST /builds/workers` and `provider_type: "cloudflare_artifacts"`. Each container needs its own Worker: a container application belongs to one Durable Object namespace.
  3. Start a build. It builds the image, pushes it to the account's registry and runs `wrangler deploy`.

  **Runs:** the deployer posts each run to the outpost Worker's workers.dev URL, signed with a key derived from the root key. A dispatch namespace would avoid public URLs, but Workers for Platforms is paid.

  **User token:** the Workers Builds API rejects account tokens, so the deploy needs a user token with Workers CI and Artifacts permissions. It's a custom credential resource:
  - Create opens the dashboard's create-token page, filled in with `permissionGroupKeys`.
  - A TTY prompt takes the token, and the deploy checks it.
  - The deploy writes it to the vault, and registers it as the build token.
  - A lost value works like a GitHub App's private key: deploy fails and asks again.

  **Tested live:**
  - With only the user token, the steps built a Dockerfile and created the container application.
  - The create-token page filled in all seven permissions.
  - Creating a build config starts no build.
  - A deleted Artifacts namespace stays "not active", so its name can't be reused.
  - `cloudflare_artifacts` isn't in the documented enum, and `PUT /builds/repos/connections` rejects it with 12065.
  - Artifacts' import takes only public repos: with a read-only installation token in the URL, GitHub answered 401.
  - `isomorphic-git` pushes from a Worker, with `memfs` and `nodejs_compat`. Two force-pushed root commits replaced each other in 333 ms and 188 ms. With both libraries, the test Worker was 199 KiB gzipped.

- [ ] **Show outpost builds on GitHub.** A check run per container on the pushed commit, such as `factory/build dev`, that links to the build's log.
  - The GitHub App gets `checks: write`.
  - The deployer starts the build and returns its uuid. The router holds the App's key, so it creates the check run as `in_progress`.
  - Workers Builds has no webhook that we know of, so something polls `GET /builds/builds/{uuid}` and completes the check run. The deployer has no Durable Object or cron to poll with yet.
  - A push that doesn't change a container's source gets no check run for that container.
- [ ] **Stage 2 follow-ups:**
  - Retry a failed build. The deployer saves the source's hash once the build starts, so a failed build isn't retried until `.factory/` changes.
  - Check whether a push to an Artifacts repo with a build config starts a build by itself. If it does, the deployer's explicit build is a second one.
  - `factory infra down` deletes the Artifacts repos, but not the outpost Workers or their container applications.
  - Notation needs a public way to refer to a `worker()`'s generated name. The deployer reads Notation's internal registration for it.

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
