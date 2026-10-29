# lightbox

A sketch of lightbox's resource model on top of Notation's `@notation/resource`, written as if [RFC 0004 (contributions)](../worktrees/notation-rfcs/rfcs/0004-contributions.md) had landed.

## The model

There are two kinds of resource:

- **Concrete resources** are Notation resources: a schema, operations that call an API, and typed dependencies that only read each other's outputs. Only real infrastructure is concrete: a GitHub App, a Cloudflare Worker, a KV namespace, the KV entry that holds the router's config.
- **Groups** are what lightbox is described in: Router, Connection, Channel, Workspace. Each is a plain class that extends Notation's `ResourceGroup`, as `ApiGroup` and `LambdaGroup` do in `@notation/aws`. Its constructor adds the concrete resources it owns, or contributes to ones that already exist, and exposes the ones other groups need as typed fields.

So there's one graph. The groups are its groups and the concrete resources are its members. Notation collects it and deploys the concrete resources.

```ts
const router = new cloudflare.Router({ id: "router", config: { name: "acme-router" } });

const gh = new github.Connection({
  id: "gh",
  config: { name: "acme-agents", org: "acme" },
  dependencies: { router },
});

const issues = gh.channel({ id: "issues", config: { scope: "acme/app" } });

issues.onIssueComment({
  actions: ["created", "edited"],
  mention: "@claude",
  from: github.collaborators(),
});

new Workspace({
  id: "issues",
  config: { branch: "issue-{id}", base: "main" },
  dependencies: { channel: issues },
});
```

collects these concrete resources:

```
router-kv, router-worker, router-config, gh-app
```

The channel, its rule and the workspace provision nothing of their own. Each contributes its entry to the router's config:

```json
{
  "channels": { "issues": { "provider": "github", "scope": "acme/app", "source": "<gh-app's id>" } },
  "rules": {
    "issues/issue_comment/{…}": {
      "channel": "issues", "provider": "github", "event": "issue_comment",
      "match": { "actions": ["created", "edited"], "mention": "@claude", "from": { "kind": "collaborators" } }
    }
  },
  "workspaces": { "issues": { "channel": "issues", "branch": "issue-{id}", "base": "main" } }
}
```

The rule also contributes to the connection's App, `events: ["issue_comment"]` and `permissions: { issues: "read" }`, so GitHub sends the deliveries the router matches.

### Contracts

A contract is an interface in `packages/lightbox/contracts/`: the fields and methods every provider's group has, so other groups can rely on them whichever provider built it.

```ts
export interface Router extends ResourceGroup {
  readonly api: RouterApi;           // where it's reached
  readonly store: RouterConfigStore; // where its config is contributed to
}

export interface Connection extends ResourceGroup {
  readonly router: Router;
  channel(opts: ChannelOptions): Channel;
}

export interface Channel extends ResourceGroup {
  readonly key: string;
  readonly connection: Connection;
}
```

The router's config is `store`, not `config`, because `ResourceGroup` already uses `config` for the group's own options. Likewise a channel's `key` is the id it was constructed with, which keys it in the router's config: `ResourceGroup`'s own `id` is Notation's number for the group.

### Implementing one

A provider exports classes that `implements` the contracts. A group is constructed like a concrete resource, with `{ id, config, dependencies }` typed by Notation's `ResourceOpts`. Each constructor validates its config with valibot, calls `super` with its dependencies' group ids, then adds its resources:

```ts
export class Connection extends ResourceGroup implements ConnectionContract {
  readonly router: Router;
  readonly app: AppInstance;

  constructor({ id, config, dependencies }: ConnectionOptions) {
    const { name, org } = v.parse(connectionConfig, config);
    super("github/Connection", { name, org, dependencies: { router: dependencies.router.id } });
    this.router = dependencies.router;
    this.app = this.add(new App({ id: `${id}-app`, config: { name, org }, dependencies: { router: dependencies.router.api } }));
  }

  channel(opts: ChannelOptions): Channel {
    return new Channel({ ...opts, dependencies: { connection: this } });
  }
}
```

A channel is made by its connection, so a channel on a GitHub connection is always GitHub's channel, typed as one: `issues.connection.app` is the App, and `issues.onIssueComment` exists. Workspace is lightbox's own, in `packages/lightbox/implementations/`, and works with any provider's channel.

## Contributions (RFC 0004)

`packages/notation-resource` is `@notation/resource` at notation@26fcf88, with RFC 0004 applied. `tsconfig.json` maps `@notation/resource` to it.

- **Collected params.** A schema item can have `collect`, a rule for combining contributions. The router's config uses `mergeRecords`, so each contributor owns its keys.
- **`resource.contribute(values, { by })`** only accepts the resource's collected params. Library code passes `by` so a conflict names what the user declared: `"issues" is contributed twice: by workspace issues (…) and by workspace issues (…)`.
- **Output values.** `resource.out.<field>` is an output usable before it exists, whole or inside a template string. A contribution that holds one makes its target depend on that resource. At plan it's `UNKNOWN_AFTER_APPLY` at its own path, and at deploy it's the real value.
- **Order doesn't matter.** Contributions are combined in a stable order, so moving code never changes the result.
- **Contributions close after evaluation.** A late `contribute` throws.
- **`resource.dependOn(other)`** adds an ordering-only dependency.

On Cloudflare, the router's config is its own resource, a KV entry, rather than a param of the Worker. The App needs the Worker's URL and the channel contributes the App's id, so as a Worker param it would close a cycle. Making the collection its own resource is RFC 0004's answer to that.

## Layout

```
packages/notation-resource/  @notation/resource, with RFC 0004 applied (src/contributions.ts)
packages/lightbox/           lightbox(), and its types
  contracts/                 Router, Connection, Channel: the interfaces providers implement
  implementations/           Workspace, which lightbox builds itself
packages/cloudflare/         Router, as a KV namespace, a Worker and a config entry
packages/github/             Connection, as an App; Channel, made by it, and its rules
examples/lightbox.infra.ts   the graph above
```

## Running

```sh
pnpm install
pnpm typecheck
```

The API calls (`packages/*/lib/`) are stubs, so nothing deploys yet.

## Not done

- **Contributions across deployments.** A repo's workspaces would contribute to the hub's router config, which lives in another deployment. Contributions only work within one deployment.
- **The planner.** `getParams` combines and resolves contributions. Notation's planner still needs RFC 0004's plan display, and its tokens for `deriveParams`.
- **Call sites.** A contribution records the first stack frame outside `@notation/resource`. For lightbox's own types that's a line in core, not the user's infra file, which is why they pass `by`.
- **Operation context.** The App's `create` opens a browser, but Notation's operation context has no `open` or `prompt`.
- **Changing an App's events or permissions.** GitHub has no API for them, so the App's `update` calls `requestAppChange`, a stub that throws. It needs the same browser step as `create`.
- **Secrets.** The App's private key is a `hidden` computed field. A write-only, fingerprinted secret is still to come.
