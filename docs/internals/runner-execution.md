# Runner Execution & Prompts

Notation Factory runs the container HTTP server (`packages/factory/runner/index.ts`) as PID 1 on port 8080. Rather than baking runner or plugin versions into repository Dockerfiles, the container entrypoint downloads `runner.ts` at boot from `http://runner.factory/runner.ts` and dynamically imports runtime and code-host modules per version.

## Request intake and locking

The outpost Worker wakes the container via `startAndWaitForPorts` (passing account and allowed outpost secrets as container env vars) and posts signed `Run` payloads to `POST /runs`. The runner queues runs immediately with 202 and serializes work using two async mutex chains:

| Lock key | Serialization scope |
| :--- | :--- |
| `repo` | Serializes `git fetch --prune` into the bare repository clone via `fetchRepo` |
| `branch:<repo>:<branch>` | Serializes agent execution per repository branch worktree via `execute` |
| `scratch:<conv>` | Serializes agent execution per conversation scratch worktree via `execute` |

Each run fetches `code-host.ts` and `runtimes/<id>.ts` from `FACTORY_MODULES_URL` and caches them by content hash under `/data/modules/` so updated hub modules load without restarting the container.

`codeHost.setup` runs once per module version to configure git credentials and install a `gh` wrapper in `/data/bin` that reads `FACTORY_TOKEN_FILE` per invocation.

## Token refresh and environment

Before launching the agent CLI, `writeTokens` atomically writes each policy token to `/data/github/<policy>` with mode 0600 using a temporary file and rename.

While the agent runs up to the 2-hour `RUN_TIMEOUT_MS` limit, a 30-minute timer posts `TokenTicket` requests to `/tokens` and rotates those token files before GitHub's 1-hour expiry.

## Prompt construction and injection defense

When a run leaves the queue, `readThread` fetches the full thread live from `POST /messages` and compares SHA-256 `bodyHash` digests against the conversation's saved `seen` map:

- **Deduplication** – New sessions receive the whole thread; resumed sessions in the same `cwd` receive only unseen or edited messages, skipping the run silently if nothing changed and no `conversation.event` fired.
- **Trust attributes** – Rendered `<message>` tags carry sender identity, role, and `can_trigger_agent` attributes for human posts or `agent` for hub replies, escaping embedded message tags in bodies.
- **System prompt** – `systemPrompt` combines the runner's headless instructions, channel context such as repository and role definitions, and the agent's optional `.factory/` prompt file.

## Streaming progress and shutdown

While streaming CLI output, `replies` throttles `POST /relay` edits to every 10 seconds (`PROGRESS_INTERVAL_MS`) and updates the elapsed clock every 60 seconds (`CLOCK_INTERVAL_MS`).

Each update passes the router-signed `ReplyMessage` ID so progress overwrites the same comment throughout the run.

## Heartbeats

For each run it holds, queued or running, the runner posts a heartbeat to the run's `reply.heartbeat` URL when it takes the run and then every 60 seconds (`HEARTBEAT_INTERVAL_MS`). Each heartbeat has the ID of the message that the run's replies replace. When the run finishes, the runner posts a heartbeat with `done`. If the router can't be reached or answers with a 5xx status, the runner posts the `done` heartbeat again after 10 seconds (`FACTORY_DONE_RETRY_MS`), up to 3 times in all. The router marks a run lost after 5 minutes without a heartbeat. See [Routing & Deliveries](./routing-and-deliveries.md#heartbeats-and-lost-runs).

If the router answers that it has marked the run lost, the run is over. A queued run doesn't start. A running run's agent gets `SIGTERM`, and the runner saves the worktree and the session as it does after any run. The saved session keeps the messages it had seen before the run, so a restart of the run gets the lost run's messages again. The runner posts nothing more for a lost run, so it doesn't replace the router's lost notice. Once the agent has stopped, the next run in the worktree can start.

## Container logs

The runner writes one JSON object per line to stdout, which is the container's log. Each line has an `at` timestamp. Runs log when they start, finish, fail, or are skipped.

The runner also logs each tool that the agent calls, if the runtime's runner module has a `tools` function. The line has the run's ID, the worktree's branch or `scratch`, the tool's name, and its main argument, such as the shell command or the file's path. The runtime returns each tool's name and input, and the runner picks the argument: the first of the input's `command`, `file_path`, `directory_path`, `path`, `pattern`, `globPattern`, `url`, `query`, `description` and `prompt` that is a string, or else the whole input as JSON. The argument is put on one line and cut to 200 characters:

```json
{"at":"2026-11-26T10:04:12.551Z","run":"5f0c…","worktree":"issue-127","tool":"Bash","argument":"pnpm typecheck"}
```

Claude Code's log includes its subagents' tool calls. Cursor Agent logs a tool call once, when it starts.

## earlyoom

At startup, the runner starts `earlyoom -r 60 -s 100,100 --avoid '^bun$'`. If the image has no `earlyoom`, the start fails with `ENOENT`, and the runner logs `earlyoom missing` and carries on. Otherwise it logs each line of its output as `{"earlyoom": "<line>"}`. `-s 100,100` has earlyoom act on available memory alone. `--avoid '^bun$'` lowers the score of the runner, which bun runs, so earlyoom stops the runner last.

The runner runs as `factory`, without the privilege to lower its own OOM score. Instead, it starts each agent's CLI through `sh`, which writes `500` to `/proc/self/oom_score_adj` and then runs the CLI with `exec`. The CLI and every process it starts inherit the score, so earlyoom and the kernel's OOM killer prefer them to the runner. Debian 12's earlyoom 1.7 has no `--ignore` or `--ignore-root-user`, so the runner doesn't use them. The runner doesn't pass `-g`, which would stop the whole process group.

The runner reads earlyoom's `sending SIGTERM to process <pid> ...` and `sending SIGKILL ...` lines, and adds a note to the reply of the run that is running. A container serves one worktree, and the runs in a worktree go one at a time, so at most one run is running in a container. If no run is running, the runner only logs the line.

Because Linux ignores unhandled signals on PID 1, the runner installs a `SIGTERM` handler that notifies active and queued threads with a 5-second timeout before exiting cleanly when Cloudflare puts the container to sleep. It posts no `done` heartbeat for those runs, so 5 minutes later the router replaces each one's message with the lost notice and its restart link.
