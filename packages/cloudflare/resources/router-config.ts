import { defineResource, mergeRecords } from "@notation/resource";
import type { RouterConfig as Config } from "lightbox";
import { deleteValue, getValue, putValue } from "../lib/kv.ts";
import type { KvNamespaceInstance } from "./kv.ts";

/**
 * The router's config, as one KV entry the Worker reads. Its own resource,
 * not a param of the Worker: an App needs the Worker's URL and its channel
 * contributes the App's id, so as a Worker param it would close a cycle
 * (RFC 0004: model the collection as its own resource).
 */
type RouterConfigApi = {
  Key: { namespaceId: string; key: string };
  CreateParams: {
    namespaceId: string;
    key: string;
    channels?: Config["channels"];
    rules?: Config["rules"];
    workspaces?: Config["workspaces"];
  };
  UpdateParams: undefined;
  ReadResult: undefined;
};

export const RouterConfig = defineResource<RouterConfigApi>({
  type: "cloudflare/kv/RouterConfig",
})
  .defineSchema({
    namespaceId: {
      propertyType: "param",
      presence: "required",
      secondaryKey: true,
    },
    key: { propertyType: "param", presence: "required", primaryKey: true },
    channels: {
      propertyType: "param",
      presence: "optional",
      collect: mergeRecords,
    },
    rules: {
      propertyType: "param",
      presence: "optional",
      collect: mergeRecords,
    },
    workspaces: {
      propertyType: "param",
      presence: "optional",
      collect: mergeRecords,
    },
  } as const)
  .defineOperations({
    create: async ({ namespaceId, key, ...config }) =>
      putValue({ namespaceId, key }, config),
    read: async (key) => getValue(key) as Promise<{}>,
    update: async (key, _patch, { namespaceId: _ns, key: _key, ...config }) =>
      putValue(key, config),
    delete: async (key) => deleteValue(key),
  })
  .requireDependencies<{ kv: KvNamespaceInstance }>()
  .deriveParams(({ deps }) => ({ namespaceId: deps.kv.output.id }));

export type RouterConfigInstance = InstanceType<typeof RouterConfig>;
