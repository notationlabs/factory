# Introduction

lightbox runs coding agents in remote containers and connects them to the places your team talks:

- **Listens** to messages on your communication channels (_GitHub issues, Slack, etc._)
- **Dispatches** agents into remote outposts (_Cloudflare Containers, Railway, E2B, etc._)
- **Connects** you directly to remote agents over a secure line (_SSH, Tailscale, etc._)


## The Hub

Stand up a central lightbox hub for your organisation to serve all of your outposts.

```ts [lightbox.infra.ts]
export default lightbox(() => {
  const vault = new cloudflare.Vault("vault");
  const router = new cloudflare.Router("router", { project: "acme-agents", vault });

  const gh = new github.Connection("gh", { name: "acme-agents", org: "acme", router });
  new github.CodeHost("github", { connection: gh, allow: [{ owner: "acme" }] });

  const claudeAccount = new claude.Account("claude", {
    auth: secret.env("CLAUDE_CODE_OAUTH_TOKEN"),
  });

  new cloudflare.Deployer("deployer", { router, vault, accounts: [claudeAccount] });
});
```

The `Connection` (in this case, a GitHub App) is lightbox's presence on a platform. It sends events to the `Router`, which holds its credentials.

The `CodeHost` decides which repos lightbox serves, and mints the short-lived credentials containers use to push code.

The `Deployer` provisions agent containers when a new outpost comes online (e.g. the GitHub App is installed on your repo), and gives them the `Account` credentials their agents run on.

The `Vault` holds the hub's secrets. Only the router and deployer can read it.


## Outposts

### Triggers

Wake an agent when someone you trust mentions it on an issue:

```ts [.lightbox/config.ts]
export default outpost(() => {
  const gh = github.Connection.get("acme-agents").channel({ id: "issues" }); // <-- this repo's issues

  const dev = new Container("dev", {
    image: "./Dockerfile",
    runtimes: [claude.runtime],
    policies: [code],
  });

  const coder = new claude.Agent("coder", { model: "claude-opus-5-5" });

  new Trigger("mention", {
    event: gh.issueComment({ mention: "@claude", from: github.collaborators() }),
    worktree: (event) => `issue-${event.issue.number}`, // <-- issue #42 works on branch `issue-42`
    agent: coder,
    container: dev,
  });
});
```

A `Trigger` is the whole dispatch rule: this event, from these authors, to this agent, in this container, on the branch `worktree` names. Commenting `@claude` on issue `#42` runs `coder` on branch `issue-42` and posts its reply back to the issue. See [Declaring Outposts](./outposts.md).

### Terminal handoff

Take over a running issue session from your local terminal:

```sh
lightbox container resume 42
```

Opens an SSH connection to `dev` and attaches your local terminal directly to issue `#42`'s branch and Claude session. See [Conversations & Sessions](./github-usage.md).
