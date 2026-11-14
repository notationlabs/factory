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

const envName = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "_");

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
    const token = router.vault.secret({
      id: `${id}-token`,                        // <-- `notation secret set linear-token` sets it
      binding: `LINEAR_${envName(name)}_TOKEN`, // <-- the env var the router reads it as
      consumers: ["router"],                    // <-- a connection's credentials go to the router only
    });
    router.store.contribute({
      connections: {
        [`linear/${name}`]: {
          provider: "linear",
          source: this.app.outputRef("id"),
          credentials: { token: token.binding },
        },
      },
    });
  }
}
```

The connection declares its API key in the router's vault without a source, so `factory infra up` asks for it on a terminal, and `notation secret set linear-token` sets it. To read the value from somewhere instead, pass a Notation source and a key, such as `source: env, key: "LINEAR_API_KEY"` with `env` from `@notation/std/sources`. The router's config holds the secret's `binding`, never its value, and the router reads the value through that binding. See [Secrets](./secrets.md#the-hub-vault).

A hub provider plugin implements `Vault` itself. Its `secret(...)` declares the secret in the provider's store, and its `bindings(consumer)` returns the secrets that the router or the deployer binds. Groups made after the router, such as connections, still declare secrets, so the plugin reads `bindings` only when evaluation ends, with `onEvaluationEnd` from `@notation/resource`. `VaultSecrets` from `@notation/factory` keeps the list, and rejects two secrets with one id, or two secrets that one consumer binds under the same name.

A group declared in an outpost extends `OutpostGroup` instead of `ResourceGroup`. `OutpostGroup` finds the outpost being declared, so the group can contribute its entry with `this.outpost.store.contribute(...)` without the user passing the outpost. A connection's outpost side is a separate class returned by a static `get(name)`, whose `channel(...)` makes the provider's own channel. That channel builds the provider's selectors.

Take `@notation/factory` as a peer dependency, so the plugin uses the copy of whatever installs it. Publish it, add it to the infrastructure repository, and declare its resources in `factory.infra.ts`.
