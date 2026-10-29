import type { Group } from "@factory/notation-group";
import type { ResourceOpts } from "@notation/resource";
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

/** A channel's config: `name` keys it in the router's config, `scope` is what it covers. */
export const channelConfig = v.object({ name: v.string(), scope: v.string() });
export type ChannelConfig = v.InferInput<typeof channelConfig>;

/** What every connection's `channel()` takes. The connection is its dependency, so it isn't passed. */
export type ChannelOptions = ResourceOpts<ChannelConfig, {}>;

/** Made by a connection, its dependency. Rules are declared on a provider's channel. */
export interface Channel
  extends Group<ChannelConfig, { connection: Connection }> {}
