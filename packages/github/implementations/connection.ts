import { defineGroup } from "@factory/notation-group";
import {
  type ChannelOptions,
  type Connection as ConnectionContract,
  type Router,
} from "factory";
import * as v from "valibot";
import { App } from "../resources/app.ts";
import { Channel } from "./channel.ts";

/** `new github.Connection(...)`: Notation Factory on GitHub, as one App whose webhook is the router. */
export class Connection
  extends defineGroup<ConnectionContract>({ type: "github/Connection" })
    .defineSchema(v.object({ name: v.string(), org: v.optional(v.string()) }))
    .requireDependencies<{ router: Router }>()
    .defineImplementation(({ id, config, deps, group }) => ({
      app: group.add(
        new App({
          id: `${id}-app`,
          config,
          dependencies: { router: deps.router.api },
        }),
      ),
    }))
  implements ConnectionContract
{
  channel(opts: ChannelOptions): Channel {
    return new Channel({ ...opts, dependencies: { connection: this } });
  }
}

export type ConnectionOptions = ConstructorParameters<typeof Connection>[0];
