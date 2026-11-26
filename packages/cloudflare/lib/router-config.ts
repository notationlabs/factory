import * as v from "valibot";

/** The KV key that holds the router's config. */
export const ROUTER_CONFIG_KEY = "config";

const connectionEntry = v.object({
  provider: v.string(),
  source: v.string(),
  credentials: v.record(v.string(), v.string()),
  channel: v.optional(v.string()),
});

const codeHostEntry = v.object({
  provider: v.string(),
  connection: v.string(),
  allow: v.array(v.object({ owner: v.string(), repo: v.optional(v.string()) })),
});

// The fields other than `provider` are the provider's own, such as GitHub's users.
const operatorsEntry = v.looseObject({ provider: v.string() });

/** The router's config, as the router's Worker reads it from KV. */
export const RouterConfigSchema = v.object({
  connections: v.optional(v.record(v.string(), connectionEntry)),
  codeHost: v.optional(codeHostEntry),
  operators: v.optional(operatorsEntry),
  services: v.optional(v.record(v.string(), v.object({ binding: v.string() }))),
});
