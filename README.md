# Notation Factory

Notation Factory's resource model, built on Notation's `@notation/resource`.

## The model

There are two kinds of resource:

- **Concrete resources** are Notation resources: a schema, operations that call an API, and typed dependencies that only read each other's outputs. Only real infrastructure is concrete: a GitHub App, a Cloudflare Worker, a KV namespace, the KV entry that holds the router's config.
- **Groups** are what Notation Factory is described in: Router, Connection, Channel, Workspace. Each is defined with `defineGroup`, which mirrors `defineResource`, and is constructed and read like a concrete resource: `{ id, config, dependencies }` in, `id`, `config` and `dependencies` on the instance. Its implementation adds the concrete resources it owns, or contributes to ones that already exist, and returns the ones other groups need as its `parts`.

So there's one graph. Each group holds a Notation `ResourceGroup`, as `group`, and the concrete resources are its members. Notation collects it and deploys the concrete resources.

```ts
const router = new cloudflare.Router({ id: "router", config: { name: "acme-router" } });

const gh = new github.Connection({
  id: "gh",
  config: { name: "acme-agents", org: "acme" },
  dependencies: { router },
});

const issues = gh.channel({ id: "issues", config: { name: "issues", scope: "acme/app" } });

issues.onIssueComment({
  actions: ["created", "edited"],
  mention: "@claude",
  from: github.collaborators(),
});

new Workspace({
  id: "issues",
  config: { name: "issues", branch: "issue-{id}", base: "main" },
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

### Defining a group

The two builders line up step for step:

```ts
export const Worker = defineResource<WorkerApi>({ type: "cloudflare/workers/Worker" })
  .defineSchema({ ... } as const)
  .defineOperations({ create, read, update, delete })
  .requireDependencies<{ kv: KvNamespaceInstance }>()
  .deriveParams(({ deps }) => ({ ConfigNamespaceId: deps.kv.output.id }));

export const Router = defineGroup<RouterContract>({ type: "cloudflare/Router" })
  .defineSchema(v.object({ name: v.string() }))
  .defineImplementation(({ id, config, group }) => {
    const kv = group.add(new KvNamespace({ ... }));
    return {
      api: group.add(new Worker({ ..., dependencies: { kv } })),
      store: group.add(new RouterConfig({ ..., dependencies: { kv } })),
    };
  });
```

- The generic is what the group must satisfy, as `defineResource`'s is the API it wraps. For a group it's a contract.
- `defineSchema` takes any Standard Schema. It validates `config`.
- `requireDependencies<D>()` is optional, and `D` must satisfy the contract's dependencies.
- `defineImplementation` gets `{ id, config, deps, group }`, as `deriveParams` gets `{ id, config, deps }`. It returns the group's parts, which must satisfy the contract's.

Where a resource has `output`, a group has `parts`. They exist as soon as it's constructed, whereas `output` only exists after deploy.

A group holds its `ResourceGroup` rather than extending it: `ResourceGroup` already has `id` (a number), `config` (an untyped record) and `dependencies` (group ids).

### Contracts

A contract is an interface in `packages/factory/contracts/` that extends `Group<Config, Dependencies, Parts>`. It holds what every provider's group has, so other groups can rely on it whichever provider built it.

```ts
export interface Router extends Group<{}, {}, { api: RouterApi; store: RouterConfigStore }> {}

export interface Connection extends Group<{}, { router: Router }> {
  channel(opts: ChannelOptions): Channel;
}

export interface Channel extends Group<ChannelConfig, { connection: Connection }> {}
```

The router's config part is `store`, so `router.parts.store` isn't confused with `router.config`, the router's own options.

### Implementing one

A provider exports groups defined against the contracts. A group with methods is a class that extends what `defineImplementation` returns:

```ts
export class Connection
  extends defineGroup<ConnectionContract>({ type: "github/Connection" })
    .defineSchema(v.object({ name: v.string(), org: v.optional(v.string()) }))
    .requireDependencies<{ router: Router }>()
    .defineImplementation(({ id, config, deps, group }) => ({
      app: group.add(new App({ id: `${id}-app`, config, dependencies: { router: deps.router.parts.api } })),
    }))
  implements ConnectionContract
{
  channel(opts: ChannelOptions): Channel {
    return new Channel({ ...opts, dependencies: { connection: this } });
  }
}
```

A channel is made by its connection, so a channel on a GitHub connection is always GitHub's channel, typed as one: `issues.dependencies.connection.parts.app` is the App, and `issues.onIssueComment` exists. github's Channel types that dependency as the contract plus its `app` part, not as the `Connection` class: the class's `channel()` returns `Channel`, so naming it in `Channel`'s base would make the base refer to itself.

Workspace is Notation Factory's own, in `packages/factory/implementations/`, and works with any provider's channel.

## Contributions

`packages/notation-resource` is `@notation/resource` at notation@26fcf88, with contributions applied. `tsconfig.json` maps `@notation/resource` to it.

- **Collected params.** A schema item can have `collect`, a rule for combining contributions. The router's config uses `mergeRecords`, so each contributor owns its keys.
- **`resource.contribute(values, { by })`** only accepts the resource's collected params. Library code passes `by` so a conflict names what the user declared: `"issues" is contributed twice: by workspace w1 and by workspace w2`.
- **Output values.** `resource.out.<field>` is an output usable before it exists, whole or inside a template string. A contribution that holds one makes its target depend on that resource. At plan it's `UNKNOWN_AFTER_APPLY` at its own path, and at deploy it's the real value.
- **Order doesn't matter.** Contributions are combined in a stable order, so moving code never changes the result.
- **Contributions close after evaluation.** A late `contribute` throws.
- **`resource.dependOn(other)`** adds an ordering-only dependency.

On Cloudflare, the router's config is its own resource, a KV entry, rather than a param of the Worker. The App needs the Worker's URL and the channel contributes the App's id, so as a Worker param it would close a cycle. Making the collection its own resource avoids the cycle.

## Layout

```
packages/notation-resource/  @notation/resource, with contributions applied (src/contributions.ts)
packages/notation-group/     defineGroup and Group
packages/factory/           factory(), and its types
  contracts/                 Router, Connection, Channel: the interfaces providers implement
  implementations/           Workspace, which factory builds itself
packages/cloudflare/         Router, as a KV namespace, a Worker and a config entry
packages/github/             Connection, as an App; Channel, made by it, and its rules
examples/factory.infra.ts   the graph above
```

## Running

```sh
pnpm install
pnpm typecheck
```

The API calls (`packages/*/lib/`) are stubs, so nothing deploys yet.

## Not done

- **Contributions across deployments.** A repo's workspaces would contribute to the hub's router config, which lives in another deployment. Contributions only work within one deployment.
- **The planner.** `getParams` combines and resolves contributions. Notation's planner still needs a plan display for contributions, and tokens for `deriveParams`.
- **Call sites.** A contribution records the first stack frame outside `@notation/resource`. For Notation Factory's own types that's a line in core, not the user's infra file, which is why they pass `by`.
- **Operation context.** The App's `create` opens a browser, but Notation's operation context has no `open` or `prompt`.
- **Changing an App's events or permissions.** GitHub has no API for them, so the App's `update` calls `requestAppChange`, a stub that throws. It needs the same browser step as `create`.
- **Secrets.** The App's private key is a `hidden` computed field. A write-only, fingerprinted secret is still to come.
