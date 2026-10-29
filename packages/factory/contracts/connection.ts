import type { ResourceGroup } from "@notation/resource";
import type { Channel, ChannelOptions } from "./channel.ts";
import type { Router } from "./router.ts";

/** In the infra: Notation Factory's presence on a platform, which sends its deliveries to `router`. Outposts look it up by `name`. */
export interface Connection extends ResourceGroup {
  readonly name: string;
  readonly router: Router;
}

/** In an outpost: a connection the infra declares, found by `name`. Each provider's makes its own kind of channel. */
export interface ConnectionRef extends ResourceGroup {
  readonly name: string;
  channel(opts: ChannelOptions): Channel;
}
