# Outposts

Each repository declares its Notation Factory configuration in a `.factory/` directory, keeping agent prompts, container toolchains, and dispatch rules versioned beside the code they work on. When you install the hub's GitHub App or push to the default branch, Factory evaluates that configuration and deploys isolated outpost Workers for the repository.

## Directory layout

Place all outpost configuration files under `.factory/` at the repository root:

```text [.factory/]
.factory/
├── infra.ts           # Channels, containers, policies, agents, and triggers
├── config.ts          # GitHub App IDs and optional repo override for the CLI
├── Dockerfile         # Optional custom container image built from .factory/
└── prompts/
    └── system.md      # Optional markdown prompts referenced by agents
```

| File | Role |
| :--- | :--- |
| `.factory/infra.ts` | Declares channels, containers, policies, agents, and triggers |
| `.factory/config.ts` | Maps connection names to GitHub App IDs for CLI commands |
| `.factory/Dockerfile` | Installs custom toolchains using `.factory/` as the build context |
| `.factory/prompts/*.md` | Supplies system prompt text loaded by agents at run time |

Factory reads up to 200 files under `.factory/`, with a 512 KB per-file limit, directly from the pushed commit via the GitHub API. The deployer ignores `.factory/config.ts`, which only the `factory` CLI reads locally.

## Declaring an outpost

Every resource in `.factory/infra.ts` registers into the repository's outpost config at module load time:

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
  image: "./Dockerfile",
  runtimes: [claude.runtime],
  policies: [code],
});

const coder = new claude.Agent("coder", {
  model: "claude-opus-5-5",
  effort: "high",
  systemPrompt: "./prompts/system.md",
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
  githubApps: { gh: 5841131 },
};
```

::

If `.factory/` sits in a subdirectory rather than the repository root, add `repo: "owner/name"` to `.factory/config.ts` or pass `--repo owner/name` to CLI commands.

## Channels and scopes

An outpost binds to a hub connection by name using `github.Connection.get(name)` and attaches a named channel with `.channel({ id, scope? })`:

```ts [.factory/infra.ts]
const gh = github.Connection.get("gh").channel({
  id: "issues",
});
```

| Option | Behavior |
| :--- | :--- |
| `id` | Names the channel inside the evaluated outpost configuration |
| `scope` | Overrides the target `owner/name` repository; defaults to the outpost repository when omitted |

When `scope` is omitted on a GitHub channel, the deployer fills in the outpost's own repository automatically. See [GitHub reference](../reference/github.md) for the channel selector API.

## Sandbox restrictions

The deployer strips TypeScript types with Sucrase and evaluates `.factory/infra.ts` inside an isolated Cloudflare Worker Loader with no network access and no environment variables. Because outpost files run in an untrusted sandbox, imports are strictly restricted.

| Allowed imports | Behavior |
| :--- | :--- |
| Local outpost files | Relative TypeScript and JavaScript modules resolve within `.factory/` |
| Core package | `@notation/factory` omits hub-only exports such as `OutpostSecret` |
| GitHub package | `@notation/factory-github` omits `CodeHost`, `OperatorAuth`, and `Connection` constructors |
| Agent packages | Claude, Cursor, and Droid packages expose `Agent` and `runtime` only |

Inside outposts, the GitHub package exposes only `Connection.get(name)` rather than connection constructors. Resource constructors still validate local invariants during evaluation – `Container` rejects duplicate runtimes, and `Trigger` rejects missing runtimes or setting `base` without a worktree function.

## Deploying and checking status

Install the hub's GitHub App on a repository to register its outpost and start the initial container image build:

```sh [Terminal]
factory repo install
factory repo status
```

`factory repo install` reads `githubApps` from `.factory/config.ts`, resolves each App's current slug from its ID, opens the GitHub App installation page, and polls `FACTORY_STATUS` every 3 seconds for up to 2 minutes.

GitHub only sends an `installation` webhook for a brand-new installation. If the App was already installed on the repository, push a commit to the default branch to deploy `.factory/`, then run `factory repo status`.

| Default-branch change | Effect |
| :--- | :--- |
| Infra config added or updated | Evaluates config, updates routing rules, and rebuilds changed container images |
| Prompt or Dockerfile edited | Rebuilds container images whose source hash changed |
| Infra config removed | Deletes the repository's outpost config and tears down its outpost Workers |
| Evaluation failure | Preserves the previous outpost config and records the error in `FACTORY_STATUS` |

Every deploy writes a JSON outcome to the repository's `FACTORY_STATUS` GitHub Actions variable, recording the deploy state, commit SHA, timestamp, build list, and any error message. Container image rebuilds also post a `factory/build <container>` check run on the pushed commit.

Next, configure container images, builds, policies, and disk persistence in [Containers](./containers.md).
