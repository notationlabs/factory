import { defineResource } from "@notation/resource";
import { createNamespace, deleteNamespace, getNamespace } from "../lib/kv.ts";

type KvNamespaceApi = {
  Key: { id: string };
  CreateParams: { title: string };
  UpdateParams: undefined;
  ReadResult: { id: string; title: string };
};

export const KvNamespace = defineResource<KvNamespaceApi>({
  type: "cloudflare/kv/Namespace",
})
  .defineSchema({
    title: { propertyType: "param", presence: "required", immutable: true },
    id: { propertyType: "computed", presence: "required", primaryKey: true },
  } as const)
  .defineOperations({
    create: async (params) => createNamespace(params),
    read: async (key) => getNamespace(key),
    delete: async (key) => deleteNamespace(key),
  });

export type KvNamespaceInstance = InstanceType<typeof KvNamespace>;
