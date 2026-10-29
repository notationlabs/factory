import type { ResourceGroup, ResourceOpts } from "@notation/resource";
import * as v from "valibot";
import type { Connection } from "./connection.ts";

/** In the router's config: deliveries from `source` (e.g. a GitHub App's id), in `scope`, are this channel's. */
export type ChannelEntry = { provider: string; scope: string; source: string };

/** In the router's config: a delivery of `event` that `match` accepts goes to `channel`. `match` is the provider's. */
export type RuleEntry = {
  channel: string;
  provider: string;
  event: string;
  match: unknown;
};

/** A channel's config: `scope` is what it covers. Its id keys it in the router's config. */
export const channelConfig = v.object({ scope: v.string() });
export type ChannelConfig = v.InferInput<typeof channelConfig>;

/** What every connection's `channel()` takes. The connection is its dependency, so it isn't passed. */
export type ChannelOptions = ResourceOpts<ChannelConfig, {}>;

/**
 * Made by a connection. Rules are declared on a provider's channel. `key`
 * is the id it was constructed with: ResourceGroup's own `id` is Notation's
 * number for the group.
 */
export interface Channel extends ResourceGroup {
  readonly key: string;
  readonly connection: Connection;
}
