# Writing Plugins

A plugin is an npm package that exports classes implementing `lightbox`'s contracts (see [`lightbox`](../packages/core.md#contracts)). Each class is a group: a plain class that extends Notation's `ResourceGroup`. Its constructor adds the concrete resources it owns, such as an App or a Worker, and contributes to configs that already exist, such as the router's.

A group takes its id, then one object of options: its config and its dependencies side by side. The constructor:

1. takes its dependencies out of the options, leaving its config
2. validates the config, e.g. with valibot
3. calls `super` with its type, id and config
4. adds its resources and makes its contributions

```ts [src/connection.ts]
import { ResourceGroup } from "@notation/resource";
import { type Connection as ConnectionContract, type Router, secret } from "lightbox";
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
    router.vault.secret({ id: `${id}-token`, name: `linear-${name}-token`, value: secret.prompt("Linear API key") });
    router.store.contribute({
      connections: {
        [`linear/${name}`]: {
          provider: "linear",
          source: this.app.outputValue("id"),
          credentials: { token: `linear-${name}-token` },
        },
      },
    });
  }
}
```

A group declared in an outpost extends `OutpostGroup` instead of `ResourceGroup`. `OutpostGroup` finds the outpost being declared, so the group can contribute its entry with `this.outpost.store.contribute(...)` without the user passing the outpost. A connection's outpost side is a separate class returned by a static `get(name)`, whose `channel(...)` makes the provider's own channel. That channel builds the provider's selectors.

Take `lightbox` as a peer dependency, so the plugin uses the copy of whatever installs it. Publish it, add it to the infrastructure repository, and declare its resources in `lightbox.infra.ts`.
