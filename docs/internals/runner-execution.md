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

Because Linux ignores unhandled signals on PID 1, the runner installs a `SIGTERM` handler that notifies active and queued threads with a 5-second timeout before exiting cleanly when Cloudflare puts the container to sleep.
