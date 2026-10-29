import type { ResourceGroup } from "@notation/resource";
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

/** What every connection's `channel()` takes: `name` keys it in the router's config, `scope` is what it covers. */
export const channelOptions = v.object({ name: v.string(), scope: v.string() });
export type ChannelOptions = v.InferInput<typeof channelOptions>;

/** Made by a connection. Rules are declared on a provider's channel. */
export interface Channel extends ResourceGroup {
  readonly name: string;
  readonly connection: Connection;
}
