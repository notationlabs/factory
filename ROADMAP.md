# Roadmap

A temporary list of the work that's left. Delete it once the list is empty, or once issues track the work.

## Done

- [x] **Session feedback.** The router reacts with 👀 to the comment or issue that starts a run, before it hands the run to the container. The runner reads Claude's `stream-json` output, and posts the agent's messages as one comment, which it edits with each message, at most once every 10 seconds, and then with the final reply. The router signs each posted message's id with the run's reply ticket, so a run can only edit its own comment. Droid and Cursor agents still post only the final reply, since their streaming formats aren't read yet. Not yet tested live.
- [x] **Show outpost builds on GitHub.** Each container's build is a check on the pushed commit, such as `factory/build dev`, that links to the build's log. The router writes a queued check after a deploy. The deployer's `BuildWatch` Durable Object polls the Builds API every 30 seconds, and posts signed reports to the router's `/builds` route. A failed build clears the source's hash, so the next push builds it again. When the App's permissions change, deploy opens its permissions page, waits for the change, then opens its installations. Tested live: a push's check went from queued to success, and linked to its build.
- [x] **Build each repo's outpost image with Workers Builds.** Each container gets an outpost Worker of its own. The deployer commits the container's `.factory/` to an Artifacts repo with `isomorphic-git`, and Workers Builds builds the image and deploys the Worker. The image holds nothing from Factory: its entrypoint fetches the runner from the outpost Worker. `factory infra up` takes the builds token, a user API token, on a local page. Tested live: a push built the example's `.factory/Dockerfile`, and Claude replied to a mention. See [Containers](docs/manual/containers.md#image) and [Providers](docs/manual/providers.md#cloudflare).
- [x] **Keep worktrees and sessions across container sleeps.** After each run, the runner saves the worktree as a git bundle and the Claude session to R2, through the `state.factory` host that the container's Durable Object answers. Tested live: a new container restored the untracked file and the session. The runner also handles SIGTERM now, since as PID 1 it ignored the signal and containers never slept.
- [x] **Refresh GitHub tokens during long runs.** Each run carries a ticket that the router signed. Every 30 minutes while the agent runs, the runner posts it to the router's `/tokens` route and writes the new tokens to `/data/github/`. Git's credential helper and a `gh` shim read the run's token from the file that `FACTORY_TOKEN_FILE` names, so agents no longer get `GH_TOKEN`. Not yet tested live.
- [x] **Pin containers to `WEUR`.** Notation 0.28.0 passes `constraints` through `$durableObject`'s container. `cloudflare.Deployer` takes a `regions` option, and the example hub sets `["WEUR"]`. Tested live: the container ran in Düsseldorf.
- [x] **Let containers sleep.** The deployer didn't read the runner's reply to a delivered run, and `@cloudflare/containers` counts a request as in flight until its body is read, so containers never slept. Tested live: the container stopped 10 minutes after the run's delivery. `cloudflare.Deployer`'s `sleepAfter` option sets that time for every outpost container, and defaults to `"10m"`.
- [x] **Delete outpost Workers and their container applications.** `factory infra down` deletes every Worker whose name starts with the deployer's outpost prefix, and the container application of each, with `CLOUDFLARE_API_TOKEN`. When a repo drops a container, the deployer also deletes the container's application, since Cloudflare leaves it when it deletes the Worker. Not yet tested live.
- [x] **Remove the deployer's account token.** The deployer Worker no longer binds `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` or `KNOWN_HOSTS`, and `cloudflare.Deployer` no longer takes `knownHosts`. `factory container ssh` needs a way to set authorized keys again when it's built.
- [x] **Run Droid as a runtime.** `@notation/factory-droid` provides the Droid `Account` for the hub and the `runtime` and `Agent` for outposts, the runner runs `droid exec` for agents of the `droid` runtime, and each runtime's plugin ships the `setup.sh` that installs its CLI, which the deployer adds to the container's build context as `factory-runtimes/<id>.sh`. Sessions persist under `~/.factory/sessions` like Claude's do under `~/.claude/projects`.
- [x] **Keep plugins and Factory's image needs out of the core.** Each runtime's plugin and the code host's ship a runner module, which the deployer serves to containers and the runner imports for each run, so the runner no longer knows Claude, Droid or GitHub. The deployer adds Factory's layers (bun, git, the runtimes' setups, and the `factory` user) to the end of every Dockerfile, so a repo's Dockerfile only installs its toolchain. An outpost declares its resources in `.factory/infra.ts`, and names its hub for the CLI in `.factory/config.ts`. Not yet tested live.

## Now: run Factory on this repo

These items have to be done before Factory's agents work on `notationlabs/factory`. The repo is public, so anyone can open an issue on it. Do them in this order.

- [ ] **Protect `main`.** Require a pull request for every change to `main`. Without that, an agent with `contents: write` could push to `main` directly, including to its own `.factory/`, and the push would redeploy the outpost. This is a repo setting, not code.
- [x] **Give agents the runner's system prompt.** The runner passes a system prompt of its own to `--append-system-prompt`, followed by the agent's `systemPrompt`. It says the agent runs headless, that it acts only on the messages in its prompt, that its final message is the reply, and that it opens pull requests as drafts. Tested live: the reply on #1 reported its decisions and opened no pull request, as asked.
- [x] **Trust only collaborators' threads.** A comment starts a run only if both its author and the issue's author match the selector's `from`, since the prompt quotes the opening post. Bot accounts never match, not just the hub's own App. Tested live: an owner's mention on their own issue started a run.
- [x] **Deploy a hub for `notationlabs`.** [`notationlabs/factory-hub`](https://github.com/notationlabs/factory-hub) deploys the stage `prod`. The org owns its App, `notation-factory`, and its code host allows only `notationlabs/factory`.
- [x] **Add this repo's outpost.** `.factory/` holds the config, with `@claude` and `@droid` triggers, and a Dockerfile based on Node 24 with pnpm and bun. `AGENTS.md` gives agents the checks to run, and installs without the docs site, whose private dependency containers can't clone. Tested live: a mention on [#1](https://github.com/notationlabs/factory/issues/1) ran `pnpm typecheck` and `pnpm test` in the container, and Claude replied with the results.
- [x] **Release 0.1.2.** `factory infra` runs Notation on bun, since Node won't strip types from the packages' TypeScript under `node_modules`. `github.collaborators()` asks GitHub for an author's permission when the webhook's author association doesn't show write access, since it hides private org membership. Tested live: the hub deployed with `factory infra up`, and a private member's mention started a run.

## Next

In priority order.

- [ ] **Found while deploying the `notationlabs` hub:**
  - `factory repo install` derives the App's slug from the hub's app, stage and connection, such as `factory-prod-gh`. When the App is renamed as it's created, as `notation-factory` was, the CLI can't find it. Read the slug from the hub instead.
  - The hubs on one Cloudflare account share its Secrets Store: `prod` took over the store that `test` created. `factory infra down` on either hub could delete the other's secrets.
  - The router, deployer and channel Workers have Workers Logs turned off, so a lost delivery leaves no trace. The outpost Workers have them on.

- [ ] **Build the prompt from the thread's history.** A resumed session sees only the messages since its last run, plus an edited opening post or comment. Identity and permissions are labelled. A run with nothing new is skipped. The channel contract needs a way to read a thread's messages.
- [ ] **Deliveries:** the old prototype had these, and Factory doesn't yet:
  - An inbox that saves each delivery before answering, and replays saved deliveries when the router starts.
  - De-duplication by delivery id.
  - Retries when a target is asleep. Retry each forward to the deployer or a container on a 5xx or a timeout, backing off from 2 to 60 seconds, for about 5 minutes.
  - A queue of failed deliveries, with replay, and `factory infra replay` to replay them.
  - A single post on the thread when a delivery fails, saying the event was kept and how to replay it.
- [ ] **Operators:**
  - Give the router admin routes behind `OperatorAuth`, which the router doesn't read yet. They list repos, deploys and failed deliveries, and pass sync and status requests to the deployer.
  - Add `factory infra status`, which shows each repo's deploys and the failed deliveries, as `docs/manual/cli.md` already describes.
  - Have `factory infra up` wait for the deployer's sync to finish, and report its result.
- [ ] **Stage 2 follow-up:** Notation needs a public way to refer to a `worker()`'s generated name. The deployer reads Notation's internal registration for it.
- [ ] **Runner:**
  - Write an agent's `files`. Give each Claude agent its own `CLAUDE_CONFIG_DIR`, so agents in one container don't share settings or files.

## Later

In priority order.

- [ ] **Sessions:**
  - Let a comment start with `/new` to start a fresh session, or `/compact [focus]` to compact the session and reply with its size before and after.
  - Save each thread's state. When a runner restarts mid-run, mark the run interrupted and say so on the thread.
- [ ] **Runner:**
  - Disable harness commit trailers. Optionally set a custom commit trailer.
  - Make the run timeout configurable, instead of the fixed 2 hours, and cap how many runs a container runs at once.
- [ ] **CLI:**
  - Add `factory container ssh`.
  - Add `factory container resume`, which lists a container's sessions and attaches to one in the agent's interactive interface.
  - Have `factory repo install` refuse an App that lacks the events or permissions the outpost needs. When a deploy fails with a fix to make in the browser, open the fix's page, wait, and try again.
- [ ] **Deployer:**
  - Run the checks in `docs/manual/outposts.md#subscribing--deploys` before storing an outpost config. Warn about triggers that can never run and about agents whose runtime the container doesn't declare. Check each policy against the App's installation: the App exists, the installation isn't suspended, and it grants each permission on each repo.
- [ ] **Router:**
  - Check `github.team(...)` in a trigger's `from`.
  - Mint tokens for custom `Policy` types, not only `github.Policy`.
  - Implement the channel contract for Slack.
- [ ] **GitHub:** adopt an existing App by its slug, so a recreated hub keeps the App and its installations. GitHub returns a private key only when it creates an App, so adoption needs a key that you generate on the App's settings page.
- [ ] **Tests:** fakes for GitHub, Cloudflare and Claude, and an end-to-end test that runs a hub and an outpost in one process, from a webhook to a reply.

## Depends on Notation features

- [ ] **Railway:** Create infra resources.
- [ ] **Worker contributions:** let a Worker's bindings take contributions, or add a bundle resource, so the router can drop its own build script.
- [ ] **Deployer:** Once Notation has queues, watch builds through a queue of Workers Builds events instead of the `BuildWatch` alarm. Events carry the build's uuid and arrive within seconds, so the deployer no longer polls or matches commit hashes. The deployer subscribes each outpost Worker when it creates it, and maps each Artifacts commit to its repo, commit and container in KV. A build that never starts still needs a timeout.
- [ ] Make `factory infra down` safer. Show what it will delete, ask for confirmation, and take `--dry-run` and `--yes`. List the resources it doesn't delete, and open each one's delete page, including the GitHub App's settings page, as the docs say. It only prints the App's link today.
- [ ] Add `factory repo uninstall`, which opens the App's installation settings and waits for the router to drop the repo. Add `factory infra up --prune`, which deletes the containers of uninstalled repos.

## Dropped

- **Deny agents the `gh` thread commands.** Deny the agent the `gh` commands that read threads or post to them, such as `gh issue view`, `gh issue comment`, `gh api` and `gh search`, so it can't read untrusted content or reply around the router. Reason: Agents are highly prompt injection tolerant today and already have access to the gh tools from local dev.
