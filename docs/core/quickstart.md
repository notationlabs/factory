# Quickstart

Deploy a Notation Factory hub on Cloudflare, subscribe a GitHub repository, and trigger Claude Code from an issue comment. Complete [Installation](./installation.md) first so `factory`, Bun, and `gh` are available on your machine.

## 1. Configure and deploy the hub

In a new hub repository, install the hub dependencies:

```bash [Terminal]
@pm.dev("@notation/cli @notation/core @notation/std @notation/factory @notation/factory-cloudflare @notation/factory-github @notation/factory-claude")
```

Declare your Notation project config and hub resources:

::code-group

```ts [notation.config.ts]
import { defineConfig } from "@notation/core/config";

export default defineConfig({
  app: "acme-factory",
  entry: "factory.infra.ts",
  defaultStage: "prod",
});
```

```ts [factory.infra.ts]
import * as claude from "@notation/factory-claude";
import * as cloudflare from "@notation/factory-cloudflare";
import * as github from "@notation/factory-github";
import { sources } from "@notation/std/resources";

const vault = new cloudflare.Vault("vault");
const router = new cloudflare.Router("router", { vault });

const gh = new github.Connection("gh", { org: "acme", router });
new github.CodeHost("github", { connection: gh, allow: [{ owner: "acme" }] });
new github.OperatorAuth("operators", { connection: gh, users: ["alice"] });

const claudeToken = new sources.Env("claude-oauth-token", {
  config: { key: "CLAUDE_CODE_OAUTH_TOKEN", track: "scrypt" },
});
const claudeAccount = new claude.Account("claude", {
  auth: vault.secret({
    id: "claude-oauth-token",
    value: claudeToken.credentials.value,
  }),
});

new cloudflare.Deployer("deployer", {
  router,
  vault,
  accounts: [claudeAccount],
});
```

::

Generate a Claude OAuth token with `claude setup-token`, export your Cloudflare and Claude credentials, and deploy the hub:

```bash [Terminal]
export CLOUDFLARE_ACCOUNT_ID="your-cloudflare-account-id"
export CLOUDFLARE_API_TOKEN="your-cloudflare-api-token"
export CLAUDE_CODE_OAUTH_TOKEN="your-claude-oauth-token"
factory infra up
```

On the first deploy, Factory opens your browser twice: first to confirm creating the GitHub App and obtain its numeric App ID, and second to paste a Cloudflare user API token for Workers Builds. See [Cloudflare Provider](./cloudflare.md).

`factory infra up` also prints the router URL. Save it in `factory.config.ts` beside `factory.infra.ts` so the status and replay commands can reach the hub:

```ts [factory.config.ts]
export default {
  router: "https://your-router-url.workers.dev",
};
```

## 2. Declare the repository outpost

In your `acme/webapp` repository, install the outpost packages:

```bash [Terminal]
@pm.dev("@notation/factory @notation/factory-github @notation/factory-claude")
```

Add `.factory/infra.ts` and `.factory/config.ts`, replacing `123456` with the GitHub App ID printed during hub deployment:

::code-group

```ts [.factory/infra.ts]
import { Container, Trigger } from "@notation/factory";
import * as claude from "@notation/factory-claude";
import * as github from "@notation/factory-github";

const gh = github.Connection.get("gh").channel({ id: "issues" });

const code = new github.Policy("code", {
  permissions: { contents: "write", pull_requests: "write" },
});

const dev = new Container("dev", {
  runtimes: [claude.runtime],
  policies: [code],
});

const coder = new claude.Agent("coder", {
  model: "claude-opus-5-5",
  effort: "high",
});

new Trigger("mention", {
  event: gh.issueComment({
    actions: ["created", "edited"],
    mention: "@claude",
    from: github.collaborators(),
  }),
  worktree: (event) => `issue-${event.issue.number}`,
  agent: coder,
  container: dev,
});
```

```ts [.factory/config.ts]
export default {
  githubApps: { gh: 123456 },
};
```

::

Omitting `image` on `Container` uses Factory's default Debian image and installs Claude Code automatically. Commit and push `.factory/` to the default branch so the deployer can read it:

```bash [Terminal]
git add .factory && git commit -m "Add Factory outpost" && git push
```

## 3. Subscribe the repository

From the root of `acme/webapp`, run `factory repo install`:

```bash [Terminal]
factory repo install
```

`factory repo install` opens GitHub to install the hub's App on `acme/webapp`, then polls until the hub deploys the outpost and records `FACTORY_STATUS` on the repository.

Check outpost status from either repository:

```bash [Terminal]
factory repo status
factory infra status
```

Running `factory infra status` from the hub repository opens your browser to sign in as an operator listed in `OperatorAuth`.

## 4. Trigger an agent from GitHub

Open issue `#42` on `acme/webapp` and comment with `@claude`:

```text [GitHub issue #42]
@claude explain how the request handler validates sessions
```

Factory checks that the comment author is a repository collaborator, creates or checks out branch `issue-42` in a container worktree, runs `coder` with the `code` policy token, and posts the response back to issue `#42`.
