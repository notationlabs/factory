# Notation Factory

Notation Factory's resource model, built on Notation's `@notation/resource`.

## The model

There are two kinds of resource:

- **Concrete resources** are Notation resources: a schema, operations that call an API, and typed dependencies that only read each other's outputs. Only real infrastructure is concrete: a GitHub App, a Slack app, a Cloudflare Worker, a KV namespace, an R2 bucket, a Secrets Store item, a Railway service, the entry that holds the router's config, the entry that holds an outpost's config.
- **Groups** are what Notation Factory is described in: Vault, Router, Deployer, Connection, CodeHost, OperatorAuth, Account, Channel, Container, Policy, Agent, Trigger. Each is a plain class that extends Notation's `ResourceGroup`, as `ApiGroup` and `LambdaGroup` do in `@notation/aws`. Its constructor adds the concrete resources it owns, or contributes to ones that already exist, and exposes the ones other groups need as typed fields.

There are two graphs, each deployed on its own:

- **The hub** (`factory(() => …)`) is the organisation's shared services. Notation collects it and deploys its concrete resources.
- **An outpost** (`outpost(() => …)`) is one repo's channels, containers, policies, agents and triggers. The deployer calls it with the repo it's deploying. Everything in it contributes to one concrete resource, the outpost's config, which the deployer applies. An outpost finds the hub's connections by name, with `github.Connection.get("acme-agents")`.

### The hub

```ts
export default factory(() => {
  const vault = new cloudflare.Vault({ id: "vault" });
  const router = new cloudflare.Router({
    id: "router",
    config: { project: "acme-agents" },
    dependencies: { vault },
  });

  const gh = new github.Connection({
    id: "gh",
    config: { name: "acme-agents", org: "acme" },
    dependencies: { router },
  });
  new github.CodeHost({
    id: "github",
    config: { allow: [{ owner: "acme" }] },
    dependencies: { connection: gh },
  });
  new github.OperatorAuth({
    id: "operators",
    config: { logins: ["alice"] },
    dependencies: { connection: gh },
  });

  const claudeAccount = new claude.Account({
    id: "claude",
    config: { auth: secret.env("CLAUDE_CODE_OAUTH_TOKEN") },
  });
  new cloudflare.Deployer({
    id: "deployer",
    dependencies: { router, accounts: [claudeAccount] },
  });
});
```

collects these concrete resources:

```
vault-store, router-kv, router-bucket, router-root-key, router-worker, router-config,
gh-app, gh-private-key, deployer-token, deployer-claude-CLAUDE_CODE_OAUTH_TOKEN, deployer-worker
```

Secrets are vault items, added by `vault.secret(...)`: the router generates the root key, the connection writes its App's private key, and the deployer writes its API token and each account's secrets. `secret.env`, `secret.generated`, `secret.prompt` and `secret.output` say where each value comes from. A secret is planned by its source and a fingerprint, never by reading it back.

The connection, code host and operator auth each contribute their entry to the router's config:

```json
{
  "connections": {
    "github/acme-agents": {
      "provider": "github",
      "source": "<gh-app's id>",
      "credentials": { "privateKey": "github-acme-agents-private-key" }
    }
  },
  "codeHost": {
    "provider": "github",
    "connection": "acme-agents",
    "allow": [{ "owner": "acme" }]
  },
  "operators": {
    "provider": "github",
    "connection": "acme-agents",
    "logins": ["alice"]
  }
}
```

`codeHost` and `operators` are collected with `single`: a second code host is a conflict naming both. The connection also contributes the App's manifest to the App: `events: ["issues", "issue_comment", "push"]` and its permissions.

### An outpost

```ts
export default outpost(() => {
  const gh = github.Connection.get("acme-agents").channel({ id: "issues" }); // <-- scope defaults to the outpost's repo

  const code = new github.Policy({
    id: "code",
    config: { permissions: { contents: "write", pull_requests: "write" } },
  });
  const dev = new Container({
    id: "dev",
    config: { image: "./Dockerfile", runtimes: [claude.runtime] },
    dependencies: { policies: [code] },
  });
  const coder = new claude.Agent({
    id: "coder",
    config: { model: "claude-opus-5-5" },
  });

  new Trigger({
    id: "mention",
    config: {
      event: gh.issueComment({
        mention: "@claude",
        from: github.collaborators(),
      }),
      worktree: (event) => `issue-${event.issue.number}`, // <-- `event` is typed by the selector
    },
    dependencies: { agent: coder, container: dev },
  });
});
```

collects one concrete resource, `outpost-config`, keyed by the repo:

```json
{
  "repo": "acme/webapp",
  "channels": {
    "issues": {
      "provider": "github",
      "connection": "acme-agents",
      "scope": "acme/webapp"
    }
  },
  "containers": {
    "dev": {
      "image": "./Dockerfile",
      "runtimes": ["claude"],
      "policies": ["code"],
      "files": {}
    }
  },
  "policies": {
    "code": {
      "provider": "github",
      "repo": "acme/webapp",
      "permissions": { "contents": "write", "pull_requests": "write" }
    }
  },
  "agents": { "coder": { "runtime": "claude", "model": "claude-opus-5-5" } },
  "triggers": {
    "mention": {
      "channel": "issues",
      "event": "issue_comment",
      "match": {
        "actions": ["created"],
        "mention": "@claude",
        "from": { "kind": "collaborators" }
      },
      "agent": "coder",
      "container": "dev",
      "worktree": {}
    }
  }
}
```

A selector such as `gh.issueComment(...)` is data the router matches, typed by the events it matches. The container is data too, so the router knows what to wake. A trigger's `worktree` function isn't: the runner imports the config to call it. It sits beside `event` in the trigger's config, so TypeScript infers its event from `event`. A container that lists a runtime twice, or a trigger whose container lacks its agent's runtime, throws when it's declared.

### Contracts

A contract is an interface in `packages/factory/contracts/`: the fields and methods every provider's group has, so other groups can rely on them whichever provider built it.

```ts
export interface Vault extends ResourceGroup {
  readonly provider: string;
  secret(opts: VaultSecretOptions): BaseResource;
}

export interface Router extends ResourceGroup {
  readonly api: RouterApi; // where it's reached
  readonly store: RouterConfigStore; // where its config is contributed to
  readonly vault: Vault; // on the router's own provider
}

export interface Connection extends ResourceGroup {
  readonly name: string;
  readonly router: Router;
} // in the hub
export interface ConnectionRef extends ResourceGroup {
  readonly name: string;
  channel(opts: ChannelOptions): Channel;
} // in an outpost
export interface Channel extends ResourceGroup {
  readonly key: string;
  readonly scope: string;
  readonly connection: ConnectionRef;
}
```

`hub.ts` has `CodeHost`, `OperatorAuth`, `Account` and `Deployer`. `outpost.ts` has `Runtime`, `Agent`, `PolicyContract` and the outpost config's entries.

The router's config is `store`, not `config`, because `ResourceGroup` already uses `config` for the group's own options. Likewise a channel's `key` is the id it was constructed with, which keys it in the outpost's config: `ResourceGroup`'s own `id` is Notation's number for the group.

### Implementing one

A provider exports classes that `implements` the contracts. A group is constructed like a concrete resource, with `{ id, config, dependencies }` typed by Notation's `ResourceOpts`. Each constructor validates its config with valibot, calls `super` with its dependencies' group ids, then adds its resources and makes its contributions:

```ts
export class Connection extends ResourceGroup implements ConnectionContract {
  readonly name: string;
  readonly router: Router;
  readonly app: AppInstance;

  constructor({ id, config, dependencies }: ConnectionOptions) {
    const { name, org } = v.parse(connectionConfig, config);
    super("github/Connection", { name, org, dependencies: { router: dependencies.router.id } });
    this.name = name;
    this.router = dependencies.router;
    this.app = this.add(new App({ id: `${id}-app`, config: { name, org }, dependencies: { router: dependencies.router.api } }));
    this.router.vault.secret({ id: `${id}-private-key`, name: `github-${name}-private-key`, value: secret.output(this.app.out.privateKey) });
    this.router.store.contribute({ connections: { [`github/${name}`]: { provider: "github", source: this.app.out.id, credentials: { … } } } }, { by: `connection ${id}` });
  }

  static get(name: string): ConnectionRef {
    return new ConnectionRef({ id: name, config: { name } });
  }
}
```

A channel is made by its connection ref, so a channel on a GitHub connection is always GitHub's channel, typed as one: `gh.issueComment` exists, and `slack`'s channel has `mention` instead. Container, Policy (for a plugin's own credentials) and Trigger are Notation Factory's own, in `packages/factory/implementations/`, and work with any provider's channels, policies and agents.

## Contributions

`packages/notation-resource` is `@notation/resource` at notation@26fcf88, with contributions applied. `tsconfig.json` maps `@notation/resource` to it.

- **Collected params.** A schema item can have `collect`, a rule for combining contributions. The router's and outpost's configs use `mergeRecords`, so each contributor owns its keys, and Notation Factory's `single` for what an infra has one of.
- **`resource.contribute(values, { by })`** only accepts the resource's collected params. Library code passes `by` so a conflict names what the user declared: `"codeHost" is contributed twice: by code host h1 (…) and by code host h2 (…)`.
- **Output values.** `resource.out.<field>` is an output usable before it exists, whole or inside a template string. A contribution that holds one makes its target depend on that resource. At plan it's `UNKNOWN_AFTER_APPLY` at its own path, and at deploy it's the real value.
- **Order doesn't matter.** Contributions are combined in a stable order, so moving code never changes the result.
- **Contributions close after evaluation.** A late `contribute` throws.
- **`resource.dependOn(other)`** adds an ordering-only dependency. A vault item whose value is another resource's output depends on that resource this way.

On Cloudflare, the router's config is its own resource, a KV entry, rather than a param of the Worker. The App needs the Worker's URL and the connection contributes the App's id, so as a Worker param it would close a cycle. Making the collection its own resource avoids the cycle. On Railway it's a file on the router service's volume, for the same reason.

## Layout

```
packages/notation-resource/  @notation/resource, with contributions applied (src/contributions.ts)
packages/factory/           factory(), outpost(), secret, and their types
  contracts/                 Vault, Router, Connection, Channel, CodeHost, Account, …: the interfaces providers implement
  implementations/           Outpost, Container, Policy, Trigger, which factory builds itself
  resources/                 OutpostConfig, the entry the deployer applies
packages/cloudflare/         Vault (Secrets Store), Router (Worker, KV, R2, config entry), Deployer (Worker), OperatorAuth (Access)
packages/railway/            Vault (sealed variables), Router (project, service, config file), Deployer (service)
packages/github/             Connection (an App), CodeHost, OperatorAuth; ConnectionRef, Channel and its selectors, Policy
packages/slack/              Connection (an app); ConnectionRef, Channel and its selectors
packages/claude/             Account; Agent, runtime
examples/factory.infra.ts   a hub on Cloudflare, with GitHub and Slack
examples/railway.infra.ts    a hub on Railway, with two GitHub connections
examples/outpost.config.ts   an outpost with GitHub and Slack triggers
```

## Running

```sh
pnpm install
pnpm typecheck
pnpm compile   # writes dist/<example>.json: each example's groups and resources, with planned params
pnpm view      # the same, plus dist/index.html, which it opens: each graph laid out in dependency order
```

Outputs that only exist after deploy show as `<resource-id.field>`. The outpost is compiled for `acme/webapp`.

The API calls (`packages/*/lib/`) are stubs, so nothing deploys yet.

## Not done

- **Contributions across deployments.** An outpost doesn't contribute to the hub: the deployer applies its config and tells the router about its triggers. `Connection.get(name)` only records the name, and nothing checks that the hub declares it or that a scope is granted and belongs to one repo.
- **The planner.** `getParams` combines and resolves contributions. Notation's planner still needs a plan display for contributions, and tokens for `deriveParams`.
- **Call sites.** A contribution records the first stack frame outside `@notation/resource`. For Notation Factory's own types that's a line in core, not the user's infra file, which is why they pass `by`.
- **Operation context.** The GitHub and Slack apps' `create` opens a browser, and `secret.prompt` asks for a value, but Notation's operation context has no `open` or `prompt`.
- **Changing an App's events or permissions.** GitHub has no API for them, so the App's `update` calls `requestAppChange`, a stub that throws. It needs the same browser step as `create`.
- **Protected resources.** The vault, GitHub Apps and Slack apps throw on `delete`. `infra down` should leave them and open their settings instead.
- **Secrets.** A vault item's `source` is a `sensitive` param and its fingerprint a computed field. A secret from `secret.output` is resolved into params at deploy, so the App's private key passes through them.
