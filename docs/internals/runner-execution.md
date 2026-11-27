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

The runner posts a heartbeat for each run it holds. It posts one when it takes the run and then one every 60 seconds (`HEARTBEAT_INTERVAL_MS`). The run's final reply carries `done`. A run that ends without a reply, such as a skipped run, sends a `done` heartbeat instead. If that heartbeat fails with a network error or a 5xx status, the runner tries again after 10 seconds, up to 3 times in total.

If the router answers a heartbeat with `lost`, or refuses a reply with 409, the runner ends the run. A queued run doesn't start. For a running run, the runner stops the agent and saves the worktree and session. It posts nothing more for that run.

## Stopping the agent

The runner starts each command in its own process group. To stop the agent, it sends `SIGTERM` to the group, and `SIGKILL` 10 seconds later. This also stops the processes that the agent started, such as `tsc` or a dev server. The runner stops the agent when the run is lost or when it has run for 2 hours.

## Container logs

The runner writes one JSON object per line to stdout, which is the container's log. It logs when each run starts, finishes, fails or is skipped.

It also logs each tool call the agent makes, using the runtime's `tools` function. The line has the run ID, the worktree's branch, the tool name and the tool's main argument:

```json
{"at":"2026-11-26T10:04:12.551Z","run":"5f0c…","worktree":"<branch>","tool":"Bash","argument":"pnpm typecheck"}
```

The main argument is the first string field among `command`, `file_path`, `path`, `pattern`, `url` and similar names. If there is none, it is the whole input as JSON. The runner cuts it to 200 characters.

## earlyoom

At startup, the runner runs `earlyoom -r 60 -s 100,100` and logs its output. `-s 100,100` makes earlyoom ignore swap. If earlyoom isn't installed, the runner logs `earlyoom missing` and carries on.

The runner runs as `factory`, so it can't lower its own OOM score. Instead, it starts the agent's CLI through `sh`, which sets `oom_score_adj` to 500 and then runs the CLI. Every process the agent starts inherits that score, so earlyoom kills them before the runner. Debian 12 ships earlyoom 1.7, which has no `--ignore` option, so the runner relies on the score alone.

When earlyoom kills a process, the runner adds a note to the reply of the active run. Each container serves one worktree and runs one run at a time, so the note always belongs to that run.

## Container shutdown

Linux ignores unhandled signals sent to PID 1, so the runner handles `SIGTERM` itself. When Cloudflare stops the container, the runner posts a heartbeat with `stopped` for each run it holds, with a 5-second timeout. The router then marks those runs lost and posts the lost notice and its restart link. If a heartbeat doesn't reach the router, the router marks the run lost 5 minutes after its last heartbeat.
