import { defineResource } from "@notation/resource";
import { deleteScript, getScript, uploadScript } from "../lib/worker.ts";
import type { KvNamespaceInstance } from "./kv.ts";

/** The router's Worker, bound to the namespace its config is kept in. */
type WorkerApi = {
  Key: { ScriptName: string };
  CreateParams: { ScriptName: string; ConfigNamespaceId: string };
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
    ConfigNamespaceId: { propertyType: "param", presence: "required" },
    url: { propertyType: "computed", presence: "required" },
  } as const)
  .defineOperations({
    create: async (params) => uploadScript(params),
    read: async (key) => getScript(key),
    update: async (_key, _patch, params) => uploadScript(params),
    delete: async (key) => deleteScript(key),
  })
  .requireDependencies<{ kv: KvNamespaceInstance }>()
  .deriveParams(({ deps }) => ({ ConfigNamespaceId: deps.kv.output.id }));

export type WorkerInstance = InstanceType<typeof Worker>;
