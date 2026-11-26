# `@notation/factory-github`

Integrates GitHub Apps as Notation Factory webhook connections, repository code hosts, policy token minters, and operator authentication.

## Entrypoints

| Import path | Included exports |
| :--- | :--- |
| `@notation/factory-github` | `Connection`, `CodeHost`, `OperatorAuth`, `Policy`, `collaborators`, `team`, `user`, event types |
| `factory-outpost` | Condition on `@notation/factory-github` exporting `Connection.get`, `Policy`, `collaborators`, `team`, `user`, and event and selector types |
| `@notation/factory-github/app` | CLI App utilities: `OPERATOR_CALLBACK_URL`, `createApp`, `appSlug`, `appVisibility`, `readApp`, `requestAppDeletion`, `requestAppChange`, `requestCallbackUrl` |
| `@notation/factory-github/router` | `channel`, `webhookSecret`, `verifySignature`, `mentions`, `CHANNEL_SECRETS`, `CHANNEL_VALUES` |

## Hub classes

### `Connection`

Creates a GitHub App (`github/Connection`), stores its private key and client secret in the router vault, and registers its webhook channel worker:

```ts [factory.infra.ts]
const gh = new github.Connection("gh", { router, org: "acme" });
```

Pass optional `org` to create the App under a GitHub organization instead of your personal account. Call `github.Connection.get(name)` inside `.factory/infra.ts` to obtain a `ConnectionRef`.

The App always holds these permissions: `contents`, `issues`, `pull_requests`, `actions_variables` and `checks` at `write`, and `metadata`, `actions`, `deployments` and `statuses` at `read`. Pass optional `permissions` to give the App more, or to raise one to `write`. An outpost's `Policy` can only get permissions the App holds, so this list is the most any outpost can ask for:

```ts [factory.infra.ts]
const gh = new github.Connection("gh", {
  router,
  org: "acme",
  permissions: { workflows: "write" },
});
```

GitHub has no API to change an App's permissions. When `permissions` adds to the App, the next deploy prints what to set on the App's permissions page and waits for you to save it. Then accept the new permissions on each installation.

The App needs two redirect URLs: `http://127.0.0.1:47219/callback` for operator sign-in, and `<router>/restart/callback` for restart links. GitHub has no API to add a redirect URL. For an App created before restart links, the next deploy prints the router's URL and opens the App's settings. Add it with **Add Redirect URL** and save. Keep the CLI's URL. Until you do, restart links fail at GitHub with a `redirect_uri` error.

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

A `Policy` can only get permissions its connection's App holds. The App doesn't hold `workflows` unless the hub passes it in the `Connection`'s `permissions`. A token without `workflows: "write"` can't push changes to `.github/workflows/`.

### `Channel`

Create a channel from a connection reference (`scope` defaults to the outpost repository):

```ts [.factory/infra.ts]
const gh = github.Connection.get("gh").channel({ id: "issues" });
```

| Selector method | Options |
| :--- | :--- |
| `gh.issue(opts)` | `actions?`: `"opened" \| "edited" \| "reopened" \| "labeled"`, defaults to `["opened"]`; `mention?`, `listen?`, `labels?`, `from` |
| `gh.issueComment(opts)` | `actions?`: `"created" \| "edited"`, defaults to `["created"]`; `mention?`, `listen?`, `labels?`, `from` |

On `"edited"` comment triggers with `mention`, only edits that newly add the mention match.

A run started by a mention adds the trigger's `listen` label to the issue. `listen` defaults to `<mention without @>:listening`, such as `claude:listening` for `@claude`. While the issue has the label, a new comment matches without the mention, unless it mentions another user, team or agent. Only comment triggers listen. On an issue trigger, `listen` only names the label to add. Label names in `labels` and `listen` match in any case. Set `listen: false` to need a mention every time. Remove the label from the issue to stop the agent listening.

### Author sets (`from`)

| Helper | Behavior |
| :--- | :--- |
| `github.collaborators()` | Matches non-bot users with `admin`, `maintain`, or `write` role on the repository |
| `github.user(login)` | Matches a specific GitHub login case-insensitively |
| `github.team(slug)` | Accepted in config, but currently skipped by the router and starts no runs |
