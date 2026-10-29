import type { Group } from "@lightbox/notation-group";
import type { Channel, ChannelOptions } from "./channel.ts";
import type { Router } from "./router.ts";

/** A link to a provider, which sends its deliveries to its `router` dependency. Each provider's connection makes its own kind of channel. */
export interface Connection extends Group<{}, { router: Router }> {
  channel(opts: ChannelOptions): Channel;
}
