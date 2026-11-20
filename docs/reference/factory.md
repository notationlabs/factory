# `@notation/factory`

Notation Factory's core package provides the outpost authoring classes, contract interfaces, resource definitions, and the portable router, deployer, and runner engines.

## Exports

| Import path | Purpose |
| :--- | :--- |
| `@notation/factory` | Hub resources, outpost classes, helpers, and TypeScript contracts |
| `factory-outpost` | Condition on `@notation/factory` exposing the outpost-safe subset for `.factory/infra.ts` |
| `@notation/factory/router` | Portable HTTP router, delivery helpers, signing helpers, and store contracts |
| `@notation/factory/deployer` | Outpost program compiler and evaluator helpers |
| `@notation/factory/runner` | Container PID 1 HTTP server entrypoint |

## Outpost classes

### `Container`

Declares a container environment inside `.factory/infra.ts` (`packages/factory/implementations/container.ts`):

```ts [.factory/infra.ts]
new Container(id, {
  image: "./Dockerfile",
  instanceType: "standard-1",
  runtimes: [claude.runtime],
  policies: [code],
  files: { "~/.npmrc": "./npmrc" },
});
```

| Option | Details |
| :--- | :--- |
| `image` | Optional Dockerfile path relative to `.factory/`, defaults to provider default image |
| `instanceType` | Optional machine size identifier passed to the hub provider |
| `runtimes` | Optional `Runtime[]` array defaulting to `[]`, must not repeat runtime IDs |
| `policies` | Optional `PolicyContract[]` array defaulting to `[]` |
| `files` | Optional map of `~/...` targets to `.factory/` paths or JSON objects, defaults to `{}` |

### `Trigger`

Binds an event selector, container, agent, and worktree rule in `.factory/infra.ts`:

```ts [.factory/infra.ts]
new Trigger(id, {
  event: gh.issueComment({ mention: "@claude", from: github.collaborators() }),
  agent: coder,
  container: dev,
  worktree: (event) => `issue-${event.issue.number}`,
  base: "main",
});
```

| Option | Details |
| :--- | :--- |
| `event` | Required `Selector<E>` produced by a channel |
| `agent` | Required `Agent` whose runtime must appear in `container.runtimes` |
| `container` | Required `Container` that runs the agent |
| `worktree` | Optional callback returning a branch name string or `undefined` |
| `base` | Optional branch to cut new worktrees from, valid only with `worktree` |

### `Policy` and `OutpostGroup`

`new Policy(id, { provider, scopes? })` declares a generic policy entry with `scopes` defaulting to `[]`.

Plugin authors extend `OutpostGroup` or `Outpost` to contribute entries to `OutpostConfig` without passing an outpost object explicitly.

## Hub resources and secrets

Exports marked hub-only below are omitted when `@notation/factory` resolves under the `factory-outpost` condition.

| Symbol | Role |
| :--- | :--- |
| `OutpostSecret` | Hub-only credential resource binding a secret as env var `name` for `allowedRepos` |
| `RandomKey` | Hub-only credential resource generating `Bytes` random hex bytes, minimum `16`, rotatable |
| `RecordedKey` | Hub-only computed-output resource generating `Bytes` random hex bytes, minimum `16`, stored in state |
| `RouterSync` | Hub-only resource calling `POST /sync` with `x-factory-sync` after deploy |
| `reposOverlap(a, b)` | Hub-only helper returning `true` when two `RepoPattern[]` allowlists share any repository |
| `bindingName(id)` | Normalizes `id` into an uppercase env or binding identifier |
| `scopedName(name, max)` | Computes a Notation physical name capped at `max` characters |
| `single(items, ctx)` | Unwraps a single contribution or throws `ContributionConflictError` |

## `@notation/factory/router`

| Symbol | Role |
| :--- | :--- |
| `handle(request, store)` | Portable HTTP request handler for webhooks, syncs, relays, and admin routes |
| `advance(record, store, now?)` | Advances pending dispatches in a saved delivery record |
| `redeployRepo(change, store)` | Redeploys a repository outpost config after source changes |
| `outpostKey(repo)` | Returns the lowercase store key for a repository outpost |
| `webhookPath(key)` | Returns the webhook URL path for a connection key |
| `allowsRepo(allow, repo)` | Checks whether a repository matches a `RepoPattern[]` allowlist |
| `failedDelivery` | Formats a settled failed `DeliveryRecord` into a `FailedDelivery` |
| `replayRecord` | Resets failed dispatches on a delivery record for replay |
| `settled` | Returns `true` when all dispatches in a record have succeeded or failed |
| `KEEP_DELIVERY_MS` | Retention duration for settled deliveries in milliseconds, 7 days |
| `deriveKey` | Derives a purpose-scoped HMAC key from the router root key |
| `hmacHex` | Computes a lowercase hex HMAC-SHA256 digest |
| `timingSafeEqual` | Constant-time string equality check for signatures |
| `signBuildReport` | Signs a `BuildReport` payload for the `/builds` route |
| `signSync` | Signs a `POST /sync` header value with timestamp and origin |
| `SYNC_HEADER` | Header name `x-factory-sync` carrying signed sync credentials |
| `RouterStore` | Storage and binding interface required by the router |
| `Inbox` | Delivery persistence and retry queue interface |
| `DeployLog` | Persistence interface for latest repository deploy results |
| `RemoteDeployer` | Deployer RPC contract called by the router |
| `ChannelModule` | Interface implemented by channel webhook modules |
| `RemoteChannel` | Channel worker RPC contract bound to the router |

## `@notation/factory/deployer`

| Symbol | Role |
| :--- | :--- |
| `deploy(repo, sourceFiles, context)` | Evaluates `.factory/` files and stores the repository outpost config |
| `evaluateOutpost(repo, files, context)` | Compiles and evaluates `.factory/infra.ts` into an `OutpostConfig` |
| `worktree(repo, trigger, payload, context)` | Evaluates a trigger's `worktree` callback against its deployed config |
| `outpostProgram(files)` | Builds the isolate `Program` that collects an outpost configuration |
| `worktreeProgram(files, trigger, payload)` | Builds the isolate `Program` that computes a trigger branch name |
| `Program` | ES module bundle type executed by `DeployerContext.evaluate` |
| `DeployerContext` | Platform adapter interface for isolated evaluation and outpost storage |

## `@notation/factory/runner`

Runs the container HTTP server exposing `POST /runs`, returning `202`, and `GET /status`, returning `{ active }`. Honors optional environment variables:

| Environment variable | Default |
| :--- | :--- |
| `FACTORY_RUNNER_PORT` | `8080` |
| `FACTORY_DATA` | `"/data"` |
| `FACTORY_STATE_URL` | `"http://state.factory"` |
| `FACTORY_MODULES_URL` | `"http://runner.factory"` |
| `FACTORY_TOKEN_REFRESH_MS` | `1800000` |
| `FACTORY_PROGRESS_INTERVAL_MS` | `10000` |
| `FACTORY_CLOCK_INTERVAL_MS` | `60000` |

Millisecond intervals default to 30 minutes for token refresh, 10 seconds for progress updates, and 60 seconds for clock updates.
