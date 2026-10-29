import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import {
  type ChannelOptions,
  type Connection as ConnectionContract,
  type Router,
} from "factory";
import * as v from "valibot";
import { App, type AppInstance } from "../resources/app.ts";
import { Channel } from "./channel.ts";

const connectionConfig = v.object({
  name: v.string(),
  org: v.optional(v.string()),
});
export type ConnectionOptions = ResourceOpts<
  v.InferInput<typeof connectionConfig>,
  { router: Router }
>;

/** `new github.Connection(...)`: Notation Factory on GitHub, as one App whose webhook is the router. */
export class Connection extends ResourceGroup implements ConnectionContract {
  readonly router: Router;
  readonly app: AppInstance;

  constructor({ id, config, dependencies }: ConnectionOptions) {
    const { name, org } = v.parse(connectionConfig, config);
    super("github/Connection", {
      name,
      org,
      dependencies: { router: dependencies.router.id },
    });
    this.router = dependencies.router;
    this.app = this.add(
      new App({
        id: `${id}-app`,
        config: { name, org },
        dependencies: { router: dependencies.router.api },
      }),
    );
  }

  channel(opts: ChannelOptions): Channel {
    return new Channel({ ...opts, dependencies: { connection: this } });
  }
}
