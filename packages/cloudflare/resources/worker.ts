import { defineResource, mergeRecords } from "@notation/resource";
import { deleteScript, getScript, uploadScript } from "../lib/worker.ts";
import type { KvNamespaceInstance } from "./kv.ts";
import type { R2BucketInstance } from "./r2.ts";
import type { SecretsStoreInstance } from "./secrets-store.ts";

/** A hub Worker (the router or deployer), bound to the project's namespace, the vault's store and, for the router, the bucket. */
type WorkerApi = {
  Key: { ScriptName: string };
  CreateParams: {
    ScriptName: string;
    KvNamespaceId: string;
    SecretsStoreId: string;
    BucketName?: string;
    /** Runs a Durable Object container of this instance type beside the Worker. */
    ContainerInstanceType?: string;
    /** Sleeps after this long idle, e.g. `"10m"`. Always on if unset. */
    IdleTimeout?: string;
    Vars?: Record<string, unknown>;
    /** Secrets Store bindings: each binding's name, and the store secret it reads. */
    Secrets?: Record<string, string>;
  };
  UpdateParams: undefined;
  ReadResult: { url: string };
};

export const Worker = defineResource<WorkerApi>({
  type: "cloudflare/workers/Worker",
})
  .defineSchema({
    ScriptName: {
      propertyType: "param",
      presence: "required",
      primaryKey: true,
    },
    KvNamespaceId: { propertyType: "param", presence: "required" },
    SecretsStoreId: { propertyType: "param", presence: "required" },
    BucketName: { propertyType: "param", presence: "optional" },
    ContainerInstanceType: { propertyType: "param", presence: "optional" },
    IdleTimeout: { propertyType: "param", presence: "optional" },
    Vars: { propertyType: "param", presence: "optional" },
    Secrets: {
      propertyType: "param",
      presence: "optional",
      collect: mergeRecords,
    },
    url: { propertyType: "computed", presence: "required" },
  } as const)
  .defineOperations({
    create: async (params) => uploadScript(params),
    read: async (key) => getScript(key),
    update: async (_key, _patch, params) => uploadScript(params),
    delete: async (key) => deleteScript(key),
  })
  .requireDependencies<{
    kv: KvNamespaceInstance;
    store: SecretsStoreInstance;
    bucket?: R2BucketInstance;
  }>()
  .deriveParams(({ deps }) => ({
    KvNamespaceId: deps.kv.output.id,
    SecretsStoreId: deps.store.output.id,
    ...(deps.bucket && { BucketName: deps.bucket.output.name }),
  }));

export type WorkerInstance = InstanceType<typeof Worker>;
