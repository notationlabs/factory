# Writing Plugins

A plugin is an npm package that exports classes implementing `@notation/factory`'s contracts (see [`@notation/factory`](../reference/core.md#contracts)). Each class is a group: a plain class that extends Notation's `ResourceGroup`. Its constructor adds the concrete resources it owns, such as an App or a Worker, and contributes to configs that already exist, such as the router's.

A group takes its id, then one object of options: its config and its dependencies side by side. The constructor:

1. takes its dependencies out of the options, leaving its config
2. validates the config, e.g. with valibot
3. calls `super` with its type, id and config
4. adds its resources and makes its contributions

```ts [src/connection.ts]
import { ResourceGroup } from "@notation/resource";
import { type Connection as ConnectionContract, type Router } from "@notation/factory";
import * as v from "valibot";
import { App, type AppInstance } from "./resources/app.ts";

const connectionConfig = v.object({ name: v.string(), workspace: v.string() });

export type ConnectionOptions = v.InferInput<typeof connectionConfig> & { router: Router };

export class Connection extends ResourceGroup implements ConnectionContract {
  readonly name: string;
  readonly router: Router;
  readonly app: AppInstance;

  constructor(id: string, { router, ...config }: ConnectionOptions) {
    const { name, workspace } = v.parse(connectionConfig, config);
    super("linear/Connection", id, config);
    this.name = name;
    this.router = router;
    this.app = this.add(
      new App(`${id}-app`, { config: { name, workspace }, dependencies: { router: router.api } }),
    );
    const token = router.bind(                  // <-- binds it to the router only, here as LINEAR_TOKEN
      router.vault.secret({
        id: `${id}-token`,
        value: this.app.credentials.token,      // <-- the App returns it when it's created
      }),
    );
    router.store.contribute({
      connections: {
        [`linear/${name}`]: {
          provider: "linear",
          source: this.app.outputRef("id"),
          credentials: { token },
        },
      },
    });
  }
}
```

The connection declares its API key in the router's vault. The value is a credential of the App: the App resource declares `token` with `propertyType: "credential"`, and its `create` returns it. To take the key from somewhere outside Notation instead, declare a source, such as `new sources.Env("linear-token", { config: { key: "LINEAR_API_KEY" } })` from `@notation/std/resources`, and pass its `credentials.value`. `router.bind(...)` returns the binding name, which it makes from the secret's id. The router's config holds that name, never the value, and the router reads the value through the binding. Pass a second argument to `router.bind` to choose the name yourself. See [Secrets](./secrets.md#the-hub-vault).

A hub provider plugin implements `Vault` and `Router` itself. Its `Vault.secret({ id, value })` declares a secret in the provider's store that holds the credential `value`, and returns it. Its `Router.bind(secret, name?)` binds the secret to the router's Worker or service and returns the binding name. Without `name`, it makes the name with `bindingName(secret.id)` from `@notation/factory`. The router also declares `rootKey`, whose value is a `RandomKey` from `@notation/factory`, and binds it as `FACTORY_ROOT_KEY`. The plugin's `Deployer` binds `router.rootKey` as `FACTORY_ROOT_KEY`, and each of its accounts' `secrets` under the env var name it is keyed by. It never binds a connection's credentials.

A group declared in an outpost extends `OutpostGroup` instead of `ResourceGroup`. `OutpostGroup` finds the outpost being declared, so the group can contribute its entry with `this.outpost.store.contribute(...)` without the user passing the outpost. A connection's outpost side is a separate class returned by a static `get(name)`, whose `channel(...)` makes the provider's own channel. That channel builds the provider's selectors.

Take `@notation/factory` as a peer dependency, so the plugin uses the copy of whatever installs it. Publish it, add it to the infrastructure repository, and declare its resources in `factory.infra.ts`.
