# Quick Start

Deploy a Notation Factory hub on Cloudflare, subscribe `acme/webapp`, trigger Claude Code from a GitHub issue, and resume the session in your terminal. Install the CLI first (see [Installation](./installation.md)).

## 1. Deploy the hub (`factory.infra.ts`)

In your infra repository, add the packages `factory.infra.ts` imports:

```bash
@pm.dev("factory @factory/cloudflare @factory/github @factory/claude")
```

Declare the hub for the `acme` organization:

```ts [factory.infra.ts]
import { factory, secret } from "factory";
import * as claude from "@factory/claude";
import * as cloudflare from "@factory/cloudflare";
import * as github from "@factory/github";

export default factory(() => {
  const vault = new cloudflare.Vault("vault");
  const router = new cloudflare.Router("router", { project: "acme-agents", vault });

  const gh = new github.Connection("gh", { name: "acme-agents", org: "acme", router });
  new github.CodeHost("github", { connection: gh, allow: [{ owner: "acme" }] });
  new github.OperatorAuth("operators", { connection: gh, logins: ["alice"] }); // <-- who may run `factory infra status`

  const claudeAccount = new claude.Account("claude", {
    auth: secret.env("CLAUDE_CODE_OAUTH_TOKEN"),
  });

  new cloudflare.Deployer("deployer", {
    router,
    vault,
    accounts: [claudeAccount],
    knownHosts: ["ssh-ed25519 AAAA... me@laptop"], // <-- ~/.ssh/id_ed25519.pub for `factory container resume`
  });
});
```

Sign in to Cloudflare and Claude, then bring the hub up:

```bash
@pm.dlx("wrangler login")
export CLAUDE_CODE_OAUTH_TOKEN="$(claude setup-token)"
factory infra up
```

`factory infra up` deploys the hub, writes its secrets to the vault, and creates the deployer's Cloudflare API token. It opens your browser once, to create the `acme-agents` GitHub App with its webhook set to `<router.url>/webhook`.

## 2. Declare an outpost (`.factory/`)

In `acme/webapp`, add the packages `.factory/config.ts` imports:

```bash
@pm.dev("factory @factory/github @factory/claude")
```

Define the container image where agents will run:

```dockerfile [.factory/Dockerfile]
FROM node:22.18-bookworm
RUN npm install -g bun@1.4.3
RUN curl -fsSL https://raw.githubusercontent.com/notationlabs/factory/main/install.sh | sh
RUN --mount=type=bind,from=runtime,target=/runtime sh /runtime/setup.sh
```

Wire `@claude` mentions from collaborators to that container:

```ts [.factory/config.ts]
import { Container, outpost, Trigger } from "factory";
import * as claude from "@factory/claude";
import * as github from "@factory/github";

export default outpost(() => {
  const gh = github.Connection.get("acme-agents").channel({ id: "issues" });

  const code = new github.Policy("code", {
    permissions: { contents: "write", pull_requests: "write" },
  });

  const dev = new Container("dev", {
    image: "./Dockerfile",
    runtimes: [claude.runtime],
    policies: [code],
  });

  const coder = new claude.Agent("coder", { model: "claude-opus-5-5", effort: "high" });

  new Trigger("mention", {
    event: gh.issueComment({
      actions: ["created", "edited"],
      mention: "@claude",
      from: github.collaborators(),
    }),
    worktree: (event) => `issue-${event.issue.number}`, // <-- issue #42 -> branch `issue-42`
    agent: coder,
    container: dev,
  });
});
```

Push `.factory/` to `main` so the remote deployer can read it:

```sh
git add .factory && git commit -m "Add factory config" && git push
```

## 3. Subscribe the repository

Grant the hub access to `acme/webapp` and build its container:

```sh
factory repo install
```

`factory repo install` walks through installation and waits for the initial build:

```text
1. Opens GitHub in browser ──► Install `acme-agents` on `acme/webapp`
2. Webhook wakes Deployer  ──► Checks the config, builds `dev` from `.factory/Dockerfile`
3. Deploy completes        ──► `FACTORY_STATUS` reports `dev` ready
```

## 4. Trigger from a GitHub issue

Open issue `#42` on `acme/webapp` and mention `@claude`:

```text [GitHub issue #42 comment]
@claude explain how the request handler validates sessions
```

The comment dispatches `coder` onto issue `#42`'s branch:

```text
Issue #42 comment ──► Router matches Trigger "mention" (author is a collaborator)
                  ──► Wakes Container "dev"
                  ──► Runner calls the worktree function: branch `issue-42`
                  ──► Checks out `issue-42` in `/data/worktrees/issue-42`
                  ──► Runs Agent "coder" and posts its reply to #42 through the router
```

## 5. Resume in your terminal

Take over issue `#42`'s session locally:

```sh
factory container resume 42
```

Wakes `dev` and attaches your terminal directly to `coder`'s interactive TUI inside `/data/worktrees/issue-42`.
