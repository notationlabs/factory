import * as v from "valibot";

/** The KV key that holds the router's config. */
export const ROUTER_CONFIG_KEY = "config";

const connectionEntry = v.object({
  provider: v.string(),
  source: v.string(),
  credentials: v.record(v.string(), v.string()),
});

const codeHostEntry = v.object({
  provider: v.string(),
  connection: v.string(),
  allow: v.array(v.object({ owner: v.string(), repo: v.optional(v.string()) })),
});

// The fields other than `provider` are the provider's own, such as GitHub's
// logins. The schema allows strings and lists of strings: `kvJson()` refuses
// a schema whose input can hold `unknown`, as `v.looseObject`'s does.
const operatorsEntry = v.objectWithRest(
  { provider: v.string() },
  v.union([v.string(), v.array(v.string())]),
);

/** The router's config, as the router's Worker reads it from KV. */
export const RouterConfigSchema = v.object({
  connections: v.optional(v.record(v.string(), connectionEntry)),
  codeHost: v.optional(codeHostEntry),
  operators: v.optional(operatorsEntry),
});
