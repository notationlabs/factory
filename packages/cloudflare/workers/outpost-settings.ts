import * as v from "valibot";

/**
 * How the deployer builds outpost Workers. `cloudflare.Deployer` writes it
 * to KV rather than binding it, since it holds the deployer Worker's
 * generated name.
 */
export const OutpostSettingsSchema = v.object({
  accountId: v.string(),
  /** The Artifacts namespace that holds each outpost Worker's source. */
  namespace: v.string(),
  /** The start of each outpost Worker's name. */
  prefix: v.string(),
  /** The deployer Worker's name, which outpost Workers bind as a service. */
  deployer: v.string(),
  compatibilityDate: v.string(),
  sleepAfter: v.string(),
  regions: v.optional(v.array(v.string())),
});

export type OutpostSettings = v.InferOutput<typeof OutpostSettingsSchema>;
