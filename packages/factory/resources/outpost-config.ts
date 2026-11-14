import { mergeContributions, resource } from "@notation/resource";
import * as v from "valibot";
import type { OutpostConfig as Config } from "../contracts/outpost.ts";
import { deleteOutpost, putOutpost, readOutpost } from "../lib/outpost.ts";

type OutpostConfigApi = {
  Key: {};
  CreateParams: {
    channels?: Config["channels"];
    containers?: Config["containers"];
    policies?: Config["policies"];
    agents?: Config["agents"];
    triggers?: Config["triggers"];
  };
  UpdateParams: undefined;
  ReadResult: undefined;
};

const channelEntry = v.object({
  provider: v.string(),
  connection: v.string(),
  scope: v.optional(v.string()),
});

const containerEntry = v.object({
  image: v.string(),
  runtimes: v.array(v.string()),
  policies: v.array(v.string()),
  files: v.record(
    v.string(),
    v.union([v.string(), v.record(v.string(), v.unknown())]),
  ),
});

const policyEntry = v.looseObject({ provider: v.string() });

const agentEntry = v.looseObject({ runtime: v.string() });

const triggerEntry = v.object({
  channel: v.string(),
  event: v.string(),
  match: v.unknown(),
  agent: v.string(),
  container: v.string(),
  worktree: v.optional(v.object({ base: v.optional(v.string()) })),
});

const outpostConfig = resource<OutpostConfigApi>({
  type: "factory/deployer/OutpostConfig",
  provider: "@notation/factory",
});

const outpostConfigSchema = outpostConfig.defineSchema({
  channels: {
    propertyType: "param",
    presence: "optional",
    value: v.record(v.string(), channelEntry),
    collect: mergeContributions,
  },
  containers: {
    propertyType: "param",
    presence: "optional",
    value: v.record(v.string(), containerEntry),
    collect: mergeContributions,
  },
  policies: {
    propertyType: "param",
    presence: "optional",
    value: v.record(v.string(), policyEntry),
    collect: mergeContributions,
  },
  agents: {
    propertyType: "param",
    presence: "optional",
    value: v.record(v.string(), agentEntry),
    collect: mergeContributions,
  },
  triggers: {
    propertyType: "param",
    presence: "optional",
    value: v.record(v.string(), triggerEntry),
    collect: mergeContributions,
  },
} as const);

/**
 * A repo's outpost, as the one entry the deployer applies. Its channels,
 * containers, policies, agents and triggers each contribute their part. The
 * deployer runs Notation for one repo at a time, and stores the entry under
 * that repo.
 */
export const OutpostConfig = outpostConfigSchema.defineOperations({
  create: async (config) => putOutpost(config),
  read: async () => {
    await readOutpost();
    return {};
  },
  update: async (_key, _patch, config) => putOutpost(config),
  delete: async () => deleteOutpost(),
});

export type OutpostConfigInstance = InstanceType<typeof OutpostConfig>;
