# Channels & Code Hosts

Platform plugins adapt issue trackers, chat apps, and git hosts into Notation Factory using three layers: infrastructure resources in `factory.infra.ts`, a stateless `ChannelModule` invoked by the router, and optionally a `CodeHostRunner` fetched inside outpost containers.

## Connection and channel resources

Split a platform integration into two entrypoints so outpost evaluation never imports hub secrets or Node resource SDKs:

| Export condition | Exports |
| :--- | :--- |
| `default` | `Connection`, `CodeHost`, and `OperatorAuth` hub resource groups |
| `factory-outpost` | `Connection.get`, `ConnectionRef`, `Channel`, `Policy`, and selectors |

On the hub side, `Connection` extends `ResourceGroup` to store credentials in `router.vault` and register its handler via `router.channel`.

Each connection contributes an entry to `router.store` keyed by `<provider>/<name>`.

On the outpost side, `Connection.get` returns a `ConnectionRef` whose channel factory creates an `OutpostGroup` contributing to `this.outpost.store`.

Selector methods return serializable `Selector` objects carrying `channel`, `event`, and `match` fields without executable functions so the router filters deliveries declaratively.

## CodeHost and Policy

A `CodeHost` registers itself on `router.codeHost` and throws if another code host is already declared. It contributes its provider, connection key, and allowed repository patterns to `router.store`.

If the code host serves git repositories, expose the TypeScript source of a `CodeHostRunner` module through its `runner` getter.

Each repository policy implements `PolicyContract` as an `OutpostGroup` that contributes a provider entry to the outpost's `policies` map. At dispatch and token-refresh time, the router calls the code host channel's `token` method to mint short-lived credentials.

## Implementing `ChannelModule`

Export `channel(ctx: ChannelContext): Channel<E>` from a dedicated module path registered with `router.channel`. Only Node-compatible or standard Web APIs should run here so the module bundles cleanly into Workers or lightweight services.

| Method | Behavior |
| :--- | :--- |
| `receive` | Required; verifies signatures and returns `accepted`, `source`, `ignored`, or `rejected` |
| `match` | Required; evaluates `selector.match` and returns an `AuthorCheck` or `undefined`; also gets the selectors of all the outpost's triggers on the connection, which GitHub uses to tell when a comment is addressed to another agent |
| `sync` | Required; updates the platform webhook URL and secret to point at `url` |
| `conversation` | Required for runs; returns `Conversation` context and thread reference |
| `messages` | Required for runs; fetches ordered `ThreadMessage` entries for a thread |
| `reply` | Optional; posts or edits replies with hidden agent markers when shared |
| `acknowledge` | Optional; adds an acknowledgment reaction on the incoming post; also gets the selectors of the triggers that start runs, which GitHub uses to add listen labels |
| `answered` | Optional; shows that the incoming post has been answered, once a run's last reply or failure notice is posted. GitHub removes its 👀 reaction |
| `read` | Code hosts; fetches `.factory/` files at a commit ref or default branch |
| `writeStatus` | Code hosts; updates `FACTORY_STATUS` on the repository |
| `writeCheck` | Code hosts; creates or updates a named commit check |
| `token` | Code hosts; mints a short-lived scoped repository token |
| `repos` | Code hosts; lists repositories readable by the hub |
| `signInUrl` | Sign-in; builds the OAuth URL. It returns to `redirect` if given, otherwise to the CLI's callback |
| `signIn` | Sign-in; exchanges the callback code for an `Operator` identity. Pass the same `redirect` |
| `canTrigger` | Restart links; checks whether a signed-in person is in a trigger's `from` |

Always check `performed_via_github_app` or an equivalent bot check inside `receive` and mark bot authors explicitly so agent replies never trigger infinite self-loops.

## Implementing `CodeHostRunner`

If your code host serves git repositories, expose a zero-dependency TypeScript module via `CodeHost.runner`, served inside containers at `http://runner.factory/code-host.ts`:

| Member | Behavior inside container |
| :--- | :--- |
| `cloneUrl` | Returns the HTTPS clone URL for a repository |
| `gitAuth` | Returns `git` `-c` arguments authenticating one command without writing `.git/config` |
| `setup` | Writes credential helpers and CLI wrappers into `bin` reading `$FACTORY_TOKEN_FILE` |

Reading `$FACTORY_TOKEN_FILE` on every git or CLI invocation ensures token refreshes every 30 minutes take effect immediately for long-running agent tasks.
