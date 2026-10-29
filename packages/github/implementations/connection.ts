import { ResourceGroup } from "@notation/resource";
import {
  type ChannelOptions,
  type Connection as ConnectionContract,
  type Router,
} from "lightbox";
import * as v from "valibot";
import { App, type AppInstance } from "../resources/app.ts";
import { Channel } from "./channel.ts";

const connectionOptions = v.object({
  id: v.string(),
  name: v.string(),
  org: v.optional(v.string()),
});
export type ConnectionOptions = v.InferInput<typeof connectionOptions> & {
  router: Router;
};

/** `new github.Connection(...)`: lightbox on GitHub, as one App whose webhook is the router. */
export class Connection extends ResourceGroup implements ConnectionContract {
  readonly router: Router;
  readonly app: AppInstance;

  constructor(opts: ConnectionOptions) {
    const { id, name, org } = v.parse(connectionOptions, opts);
    super("github/Connection", {
      name,
      org,
      dependencies: { router: opts.router.id },
    });
    this.router = opts.router;
    this.app = this.add(
      new App({
        id: `${id}-app`,
        config: { name, org },
        dependencies: { router: opts.router.api },
      }),
    );
  }

  channel(opts: ChannelOptions): Channel {
    return new Channel({ ...opts, connection: this });
  }
}
