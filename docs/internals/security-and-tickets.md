# Security & Tickets

Notation Factory derives every internal signing secret from a single hub `RandomKey` (`FACTORY_ROOT_KEY`) using purpose-scoped HMAC-SHA256 keys, while deploy authentication uses a separate `RecordedKey` (`FACTORY_SYNC_KEY`). Containers only receive short-lived tickets and per-run repo tokens rather than master keys.

## Purpose-derived keys

`deriveKey(rootKey, purpose)` computes `hmacHex(rootKey, purpose)` using Web Crypto HMAC-SHA256 in `packages/factory/router/keys.ts`, and `timingSafeEqual` compares signatures in constant time for equal-length digests:

| Purpose string | Used to sign and verify |
| :--- | :--- |
| `router:relay` | `ReplyTicket` payloads for `/relay` and `/messages` |
| `router:message` | `ReplyMessage` IDs bound to a specific ticket signature |
| `router:tokens` | `TokenTicket` payloads for `/tokens` refresh requests |
| `router:builds` | `BuildReport` payloads from `BuildWatch` to `/builds` |
| `operator:session` | Signed CLI bearer tokens returned by `/admin/session` |
| `outpost:<worker>` | Outpost `POST /runs` requests from deployer to outpost Worker |
| `github:webhook:<appId>` | Webhook `X-Hub-Signature-256` secret configured on GitHub |

## Sync authentication

Unlike `FACTORY_ROOT_KEY`, which stays unrecorded as a Notation credential, `FACTORY_SYNC_KEY` uses `RecordedKey` so every deployment signs `POST /sync` without rotating the root key.

The `RouterSync` resource signs requests with the `x-factory-sync` header, formatted as `<timestampMs>.<hmacHex>` over `sync:<timestampMs>:<origin>`.

The router rejects timestamps outside the 5-minute `SYNC_MAX_SKEW_MS` window or signatures targeting a different origin.

## Signed run tickets

Because a run may wait behind an image build or in a worktree queue before starting, dispatch mints two 24-hour (`REPLY_TTL_MS`) HMAC-signed tickets:

| Ticket | Route and scope |
| :--- | :--- |
| `ReplyTicket` | `POST /relay` and `POST /messages` to read threads and post or edit replies |
| `TokenTicket` | `POST /tokens` to mint 1-hour installation tokens matching container policies |

The router also signs each posted reply's comment ID with `router:message` over `[ticketSignature, messageId]`, preventing a compromised ticket or container from overwriting arbitrary comments on an issue.

## Run delivery and build report signatures

When posting a run to an outpost Worker, the deployer signs `${timestamp}.${body}` with the `outpost:<worker>` key and sends `x-factory-timestamp` and `x-factory-signature`.

The outpost Worker rejects payloads older than 5 minutes (`RUN_MAX_AGE_MS`) and delegates verification to `DEPLOYER.verifyRun` over RPC so it never holds `FACTORY_ROOT_KEY`.

`BuildWatch` uses the same pattern for `POST /builds`, attaching a 5-minute `BuildReport` expiry signed with `router:builds`.

## Service requests

A request from a container to a hub service at `<name>.factory` carries no key or ticket. The outpost Worker's outbound handler drops every `x-factory-*` header that the container sent, and sets `x-factory-repo` and `x-factory-container` from its Worker's `REPO` and `CONTAINER` vars. Each outpost Worker runs one repo's container, and the deployer sets the vars when it builds the Worker. The handler forwards the request to the router's `ServiceGateway` entrypoint over a service binding. That entrypoint has no public URL, so the router trusts the headers, and forwards the request to the service's binding. A service's Worker must have `url: false`, so that only bindings reach it. `cloudflare.Service`'s type rejects a Worker with a URL. See [Services](../authoring/services.md).

## Operator sessions

Operators authenticate through `/admin/sign-in` and `/admin/session` using GitHub OAuth. After resolving the user's login and numeric ID, the channel immediately revokes the OAuth access token.

The router checks `github.OperatorAuth.users` by case-insensitive login or numeric ID, then signs a 4-hour session token formatted as `<login>.<id>.<expires>.<sig>` using `SESSION_TTL_MS`.

Every `/admin/*` call verifies that signature and re-checks `users` live against the current router config, so removing a user revokes active sessions on the next request.
