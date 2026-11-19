# `@notation/factory-github`

`@notation/factory-github` connects GitHub repositories and issues to Notation Factory. The same entrypoint serves both config files:

```bash
@pm.dev("@notation/factory-github")
```

| Used in | Exports |
| --- | --- |
| `factory.infra.ts` | `github.Connection` (provisions the GitHub App and webhook), `github.CodeHost` (where the repositories live), `github.OperatorAuth` (operator sign-in) |
| `.factory/infra.ts` | `Connection.get`, `Policy`, `channel.issue`, `channel.issueComment`, `collaborators`, `team`, `user` |

On GitHub, one App is both the connection and the code host's token issuer.

## Connection

Register a GitHub App and wire its webhooks to your router:

```ts [factory.infra.ts]
import * as cloudflare from "@notation/factory-cloudflare";
import * as github from "@notation/factory-github";

const vault = new cloudflare.Vault("vault");
const router = new cloudflare.Router("router", { vault });

new github.Connection("gh", {
  org: "acme", // <-- omit for a personal GitHub account
  router,
});
```

An App that doesn't exist yet is created through GitHub's manifest flow in your browser, named `<app>--<stage>--<id>` (truncated with a hash at 34 characters). Deploy prints the App's ID when it creates the App. Notation keeps the App by its ID, not its name, so you can rename the App on GitHub. The App is protected: `factory infra down` leaves it.

The connection declares the App's private key in the hub vault as the secret `<id>-private-key`, here `gh-private-key`, and its client secret as `<id>-client-secret`. The router runs the connection's channel with `router.channel(...)`, which gets the private key as `PRIVATE_KEY`, the client secret as `CLIENT_SECRET`, the root key as `ROOT_KEY` and the App's id as `APP_ID`. Only the channel reads the private key and the client secret: the router and the deployer don't bind them. On Cloudflare, each connection's channel is a Worker with no URL, which the router binds as a service, such as `CHANNEL_GITHUB_GH` for the connection `gh`. The secrets' values are the App's credentials `privateKey` and `clientSecret`. GitHub returns them once, when the manifest flow creates the App, and deploy writes them to the vault in memory. GitHub has no API that makes another. So when deploy needs one again, such as after the vault secret was deleted, plan fails: generate a private key or a client secret on the App's settings page, and pass it with `factory infra up --credential`. See [Secrets](../manual/secrets.md#the-secrets-in-the-vault).

| GitHub App manifest | Value |
| --- | --- |
| **Webhook URL** | `<Url>/webhook/github/<id>`, where `Url` is the router's URL |
| **Callback URL** | `http://127.0.0.1:47219/callback`, where the CLI listens when an operator signs in |
| **Events** | `issues`, `issue_comment`, `push` |
| **Permissions** | `contents: "write"`, `issues: "write"`, `pull_requests: "write"`, `actions_variables: "write"`, `checks: "write"`, `metadata: "read"`, `actions: "read"`, `deployments: "read"`, `statuses: "read"` |

The router sets the App's webhook secret, because only the hub can read the root key that the secret is derived from. `POST <Url>/sync` makes the router ask each connection's channel to set its App's webhook URL to `<Url>/webhook/github/<id>` and its secret to the derived one. The channel authenticates as the App with its private key, so set the private key first. The route needs no auth, because it only sets the values the router derives. Deploy calls it whenever the router's URL or config changes. `github.collaborators()` matches authors whose role on the repo is `admin`, `maintain` or `write`. The channel asks GitHub for each author's role, with a `metadata: read` token, since the author association in the event doesn't show it: an org member may only be able to read. Bot accounts never match.

GitHub has no API for an existing App's permissions and events, so deploy has you change them in the browser:
1. Deploy opens the App's permissions page, and prints the permissions and events to set there.
2. Deploy waits until the App has them, through your `gh` login. After 15 minutes it fails, and the next deploy asks again.
3. Deploy opens the App's installations. Each installation accepts the new permissions on its own page. Deploy doesn't wait for that, and until an installation accepts, the router can't write its build checks and logs the error.

The grant is the App's installation: installing it on a repo (`factory repo install`) lets that repo's channel receive events.

## Code host

Every infrastructure declares one code host, where the repositories it serves live:

```ts [factory.infra.ts]
// …
new github.CodeHost("github", {
  connection: gh,
  allow: [{ owner: "acme" }], // <-- only installed repos that match get outposts
});
```

The deployer serves installed repos that match `allow`, reads `.factory/` and writes `FACTORY_STATUS` through it. The router mints containers' tokens through the App. The CLI reaches repositories through your `gh` login.

GitHub installation tokens can be limited to one repo and a set of permissions, and last an hour, so every `github.Policy` passes the code host's validation.

## Operator auth

Sign operators in with GitHub:

```ts [factory.infra.ts]
// …
new github.OperatorAuth("operators", {
  connection: gh,
  logins: ["djgrant", "alice"], // <-- GitHub logins allowed to run the CLI against the hub
});
```

The CLI signs you in with GitHub's web flow for the connection's App. The connection's channel exchanges the code for a user token with the App's client secret, reads your login, and revokes the token. The router checks your login against `logins`, without case, before it returns an admin session that lasts 4 hours. An App that an earlier version of Factory created needs a client secret and the callback URL `http://127.0.0.1:47219/callback`, which you add on its settings page. See [Signing in with GitHub](../manual/secrets.md#signing-in-with-github).

The code host's channel also lists the repos of every installation of the App that isn't suspended. `factory infra up` has the router deploy each of them again.

## Channel

Listen on this repo's issues:

```ts [.factory/infra.ts]
import * as github from "@notation/factory-github";

const gh = github.Connection.get("gh").channel({ id: "issues" }); // <-- scope defaults to the outpost's repo
```

## Selectors

Filter the issue or comment events that wake an agent:

```ts [.factory/infra.ts]
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

A conversation is an issue. Its thread is the issue's opening post, then its comments. Replies are posted as issue comments by the App, through the router's relay. The App reacts with 👀 to the comment or issue that starts a run. An issue being opened or edited, or a comment being created or edited, posts a message, which the run's prompt marks with `trigger="true"`. Any other event, such as `reopened` or `labeled`, starts the prompt with what happened and who did it, such as "The issue was labelled `ready` by @dan.", and the run always goes ahead. For such an event, both the person who acted and the issue's author must match `from`. A run's messages share one comment, which the App edits with each message and then with the final reply. If someone deletes that comment during the run, the next message is posted as a new comment.

## Policy

Grant an outpost container scoped installation tokens for a repository:

```ts [.factory/infra.ts]
import * as github from "@notation/factory-github";

const code = new github.Policy("code", {
  repo: "acme/webapp", // <-- omit to scope to the current repository
  permissions: {
    contents: "write",
    pull_requests: "write",
  },
});
```

The code host mints a 1-hour GitHub installation token scoped to `repo` and `permissions` before each agent run. A policy can only ask for permissions the App has, at the same level or lower. For an agent to follow a pull request's CI, give it `actions: "read"`, `checks: "read"`, `statuses: "read"` and `deployments: "read"`.
