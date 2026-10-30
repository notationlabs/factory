import { defineResource, mergeContributions } from "@notation/resource";
import type { OutpostConfig as Config } from "../contracts/outpost.ts";
import { deleteOutpost, putOutpost, readOutpost } from "../lib/outpost.ts";

/**
 * A repo's outpost, as the one entry the deployer applies. Its channels,
 * containers, policies, agents and triggers each contribute their part.
 */
type OutpostConfigApi = {
  Key: { repo: string };
  CreateParams: {
    repo: string;
    channels?: Config["channels"];
    containers?: Config["containers"];
    policies?: Config["policies"];
    agents?: Config["agents"];
    triggers?: Config["triggers"];
  };
  UpdateParams: undefined;
  ReadResult: undefined;
};

export const OutpostConfig = defineResource<OutpostConfigApi>({
  type: "lightbox/deployer/OutpostConfig",
})
  .defineSchema({
    repo: { propertyType: "param", presence: "required", primaryKey: true },
    channels: {
      propertyType: "param",
      presence: "optional",
      collect: mergeContributions,
    },
    containers: {
      propertyType: "param",
      presence: "optional",
      collect: mergeContributions,
    },
    policies: {
      propertyType: "param",
      presence: "optional",
      collect: mergeContributions,
    },
    agents: {
      propertyType: "param",
      presence: "optional",
      collect: mergeContributions,
    },
    triggers: {
      propertyType: "param",
      presence: "optional",
      collect: mergeContributions,
    },
  } as const)
  .defineOperations({
    create: async ({ repo, ...config }) => putOutpost({ repo }, config),
    read: async (key) => readOutpost(key) as Promise<{}>,
    update: async (key, _patch, { repo: _repo, ...config }) =>
      putOutpost(key, config),
    delete: async (key) => deleteOutpost(key),
  });

export type OutpostConfigInstance = InstanceType<typeof OutpostConfig>;
