# `@notation/factory-github`

Integrates GitHub Apps as Notation Factory webhook connections, repository code hosts, policy token minters, and operator authentication.

## Entrypoints

| Import path | Included exports |
| :--- | :--- |
| `@notation/factory-github` | `Connection`, `CodeHost`, `OperatorAuth`, `Policy`, `collaborators`, `team`, `user`, event types |
| `factory-outpost` | Condition on `@notation/factory-github` exporting `Connection.get`, `Policy`, `collaborators`, `team`, `user`, and event and selector types |
| `@notation/factory-github/app` | CLI App utilities: `OPERATOR_CALLBACK_URL`, `createApp`, `appSlug`, `appVisibility`, `readApp`, `requestAppDeletion`, `requestAppChange` |
| `@notation/factory-github/router` | `channel`, `webhookSecret`, `verifySignature`, `mentions`, `CHANNEL_SECRETS`, `CHANNEL_VALUES` |

## Hub classes

### `Connection`

Creates a GitHub App (`github/Connection`), stores its private key and client secret in the router vault, and registers its webhook channel worker:

```ts [factory.infra.ts]
const gh = new github.Connection("gh", { router, org: "acme" });
```

Pass optional `org` to create the App under a GitHub organization instead of your personal account. Call `github.Connection.get(name)` inside `.factory/infra.ts` to obtain a `ConnectionRef`.

### `CodeHost`

Designates the GitHub connection as the hub's repository source and configures repository allowlists:

```ts [factory.infra.ts]
new github.CodeHost("github", {
  connection: gh,
  allow: [{ owner: "acme", repo: "webapp" }],
});
```

Omit `repo` on a pattern in `allow` to allow all installed repositories under `owner`.

### `OperatorAuth`

Authorizes GitHub logins (matched case-insensitively) or numeric GitHub account IDs for `factory infra` admin commands:

```ts [factory.infra.ts]
new github.OperatorAuth("operators", {
  connection: gh,
  users: ["alice", 123456],
});
```

## Outpost classes and selectors

### `Policy`

Requests a 1-hour installation token for the outpost repository (or custom `repo`) with scoped permissions:

```ts [.factory/infra.ts]
const code = new github.Policy("code", {
  permissions: { contents: "write", pull_requests: "write" },
});
```

Valid permission keys accept `"read"` or `"write"`:

```ts [@notation/factory-github]
type PolicyLevel = "read" | "write";

type PolicyOptions = {
  repo?: string;
  permissions: {
    actions?: PolicyLevel;
    actions_variables?: PolicyLevel;
    checks?: PolicyLevel;
    contents?: PolicyLevel;
    deployments?: PolicyLevel;
    issues?: PolicyLevel;
    metadata?: PolicyLevel;
    pull_requests?: PolicyLevel;
    statuses?: PolicyLevel;
    workflows?: PolicyLevel;
  };
};
```

`Policy` schema validation accepts `workflows`, though `Connection`'s default App manifest does not request `workflows` permission.

### `Channel`

Create a channel from a connection reference (`scope` defaults to the outpost repository):

```ts [.factory/infra.ts]
const gh = github.Connection.get("gh").channel({ id: "issues" });
```

| Selector method | Options |
| :--- | :--- |
| `gh.issue(opts)` | `actions?`: `"opened" \| "edited" \| "reopened" \| "labeled"`, defaults to `["opened"]`; `mention?`, `labels?`, `from` |
| `gh.issueComment(opts)` | `actions?`: `"created" \| "edited"`, defaults to `["created"]`; `mention?`, `labels?`, `from` |

On `"edited"` comment triggers with `mention`, only edits that newly add the mention match.

### Author sets (`from`)

| Helper | Behavior |
| :--- | :--- |
| `github.collaborators()` | Matches non-bot users with `admin`, `maintain`, or `write` role on the repository |
| `github.user(login)` | Matches a specific GitHub login case-insensitively |
| `github.team(slug)` | Accepted in config, but currently skipped by the router and starts no runs |
