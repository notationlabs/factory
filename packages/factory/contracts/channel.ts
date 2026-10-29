import type { ResourceGroup, ResourceOpts } from "@notation/resource";
import * as v from "valibot";
import type { ConnectionRef } from "./connection.ts";

/** In an outpost's config: deliveries from `connection`, in `scope`, are this channel's. */
export type ChannelEntry = {
  provider: string;
  connection: string;
  scope: string;
};

/** A channel's config: `scope` is what it covers. Where a provider has a sensible default (GitHub: the outpost's repo), it's optional. */
export const channelConfig = v.object({ scope: v.optional(v.string()) });
export type ChannelConfig = v.InferInput<typeof channelConfig>;

/** What every connection's `channel()` takes. The connection is its dependency, so it isn't passed. */
export type ChannelOptions = ResourceOpts<ChannelConfig, {}>;

/**
 * Made by a connection in an outpost. Selectors are made by a provider's
 * channel. `key` is the id it was constructed with: ResourceGroup's own `id`
 * is Notation's number for the group.
 */
export interface Channel extends ResourceGroup {
  readonly key: string;
  readonly scope: string;
  readonly connection: ConnectionRef;
}

/**
 * Events on a channel, as data the router matches without running the repo's
 * code. `E` is the type of the events it matches, which types worktree
 * functions; `match` is the provider's, including its `from`.
 */
export type Selector<E> = {
  readonly channel: Channel;
  readonly event: string;
  readonly match: unknown;
  /** Phantom: the matched events' type. */
  readonly __event?: E;
};
