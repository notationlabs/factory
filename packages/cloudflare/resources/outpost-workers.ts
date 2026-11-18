import { defineResource } from "@notation/resource";
import * as v from "valibot";
import { deleteOutpostWorkers } from "../lib/outpost-workers.ts";

type OutpostWorkersApi = {
  Key: { AccountId: string; Prefix: string };
  CreateParams: { AccountId: string; Prefix: string; Deployer: string };
  UpdateParams: { Deployer: string };
  ReadResult: {};
};

const apiToken = () => {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error("Deleting outpost Workers needs CLOUDFLARE_API_TOKEN, with Workers Scripts Edit and Containers Edit.");
  }
  return token;
};

/**
 * The outpost Workers that a deployer creates at run time, and their
 * container applications. Create does nothing. Delete deletes every Worker
 * whose name starts with `Prefix`.
 */
export const OutpostWorkers = defineResource<OutpostWorkersApi>({
  type: "cloudflare/outposts/Workers",
  provider: "@notation/factory-cloudflare",
})
  .defineSchema({
    AccountId: { propertyType: "param", presence: "required", immutable: true, secondaryKey: true, value: v.string() },
    Prefix: { propertyType: "param", presence: "required", immutable: true, primaryKey: true, value: v.string() },
    /**
     * The deployer Worker's name. Outpost Workers bind the deployer as a
     * service, so this makes deploy delete them before the deployer.
     */
    Deployer: { propertyType: "param", presence: "required", value: v.string() },
  } as const)
  .defineOperations({
    create: async () => {},
    read: async () => ({}),
    update: async () => {},
    delete: async ({ AccountId, Prefix }) => deleteOutpostWorkers(apiToken(), AccountId, Prefix),
  });
