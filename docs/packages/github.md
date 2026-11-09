# `@notation/factory-github`

`@notation/factory-github` connects GitHub repositories and issues to Notation Factory. The same entrypoint serves both config files:

```bash
@pm.dev("@notation/factory-github")
```

| Used in | Exports |
| --- | --- |
| `factory.infra.ts` | `github.Connection` (provisions the GitHub App and webhook), `github.CodeHost` (where the repositories live), `github.OperatorAuth` (operator sign-in) |
| `.factory/config.ts` | `Connection.get`, `Policy`, `channel.issue`, `channel.issueComment`, `collaborators`, `team`, `user` |

On GitHub, one App is both the connection and the code host's token issuer.

## Connection

Register a GitHub App and wire its webhooks to your router:

```ts [factory.infra.ts]
import { factory } from "@notation/factory";
import * as cloudflare from "@notation/factory-cloudflare";
import * as github from "@notation/factory-github";

export default factory(() => {
  const vault = new cloudflare.Vault("vault");
  const router = new cloudflare.Router("router", { project: "acme-agents", vault });

  new github.Connection("gh", {
    name: "acme-agents", // <-- GitHub App name; repos look the connection up by it
    org: "acme",         // <-- omit for a personal GitHub account
    router,
  });
});
```

An App that doesn't exist yet is created through GitHub's manifest flow in your browser. Its private key goes straight into the hub vault, one item per App, and the router is the only thing that reads it. The App is protected: `factory infra down` leaves it.

| GitHub App manifest | Value |
| --- | --- |
| **Webhook URL** | `<router.url>/webhook` |
| **Events** | `issues`, `issue_comment`, `push` |
| **Permissions** | `contents: "write"`, `issues: "write"`, `pull_requests: "write"`, `actions_variables: "write"`, `metadata: "read"` |

The grant is the App's installation: installing it on a repo (`factory repo install`) lets that repo's channel receive events.

## Code host

Every infrastructure declares one code host, where the repositories it serves live:

```ts [factory.infra.ts]
export default factory(() => {
  // …
  new github.CodeHost("github", {
    connection: gh,
    allow: [{ owner: "acme" }], // <-- only installed repos that match get outposts
  });
});
```

The deployer serves installed repos that match `allow`, reads `.factory/` and writes `FACTORY_STATUS` through it. The router mints containers' tokens through the App. The CLI reaches repositories through your `gh` login.

GitHub installation tokens can be limited to one repo and a set of permissions, and last an hour, so every `github.Policy` passes the code host's validation.

## Operator auth

Sign operators in with GitHub:

```ts [factory.infra.ts]
export default factory(() => {
  // …
  new github.OperatorAuth("operators", {
    connection: gh,
    logins: ["djgrant", "alice"], // <-- GitHub logins allowed to run the CLI against the hub
  });
});
```

The CLI signs you in through the connection's App as a user-to-server token, and the router checks your login against `logins` before it returns a short-lived admin session. See [Operator auth](../manual/secrets.md#operator-auth).

## Channel

Listen on this repo's issues:

```ts [.factory/config.ts]
import * as github from "@notation/factory-github";

const gh = github.Connection.get("acme-agents").channel({ id: "issues" }); // <-- scope defaults to the outpost's repo
```

## Selectors

Filter the issue or comment events that wake an agent:

```ts [.factory/config.ts]
new Trigger("mention", {
  event: gh.issueComment({
    actions: ["created", "edited"], // <-- default: ["created"]
    mention: "@claude",
    labels: ["docs"],
    from: github.collaborators(),   // <-- required
  }),
  worktree: (event) => `issue-${event.issue.number}`, // <-- `event` is an IssueCommentEvent
  agent: coder,
  container: dev,
});
```

| Selector | Options | Matches |
| --- | --- | --- |
| `gh.issueComment(opts)` | `actions`, `mention`, `labels`, `from` | Comment `"created"` / `"edited"` events |
| `gh.issue(opts)` | `actions`, `mention`, `labels`, `from` | Issue `"opened"` / `"edited"` / `"reopened"` / `"labeled"` events |

| Author set | Matches |
| --- | --- |
| `github.collaborators()` | Users with write access to the repo |
| `github.team("acme/core")` | Members of a team |
| `github.user("alice")` | One user |

A conversation is an issue. Replies are posted as issue comments by the App, through the router's relay.

## Policy

Grant an outpost container scoped installation tokens for a repository:

```ts [.factory/config.ts]
import * as github from "@notation/factory-github";

const code = new github.Policy("code", {
  repo: "acme/webapp", // <-- omit to scope to the current repository
  permissions: {
    contents: "write",
    pull_requests: "write",
  },
});
```

The code host mints a 1-hour GitHub installation token scoped to `repo` and `permissions` before each agent run.
