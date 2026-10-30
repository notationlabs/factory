import { defineResource, mergeContributions } from "@notation/resource";
import { type RouterConfig as Config, single } from "lightbox";
import { deleteValue, getValue, putValue } from "../lib/kv.ts";
import type { KvNamespaceInstance } from "./kv.ts";

/**
 * The router's config, as one KV entry the Worker reads. Its own resource,
 * not a param of the Worker: an App needs the Worker's URL and its connection
 * contributes the App's id, so as a Worker param it would close a cycle
 * (RFC 0004: model the collection as its own resource).
 */
type RouterConfigApi = {
  Key: { namespaceId: string; key: string };
  CreateParams: {
    namespaceId: string;
    key: string;
    connections?: Config["connections"];
    codeHost?: Config["codeHost"];
    operators?: Config["operators"];
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
    connections: {
      propertyType: "param",
      presence: "optional",
      collect: mergeContributions,
    },
    codeHost: {
      propertyType: "param",
      presence: "optional",
      collect: single,
    },
    operators: {
      propertyType: "param",
      presence: "optional",
      collect: single,
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
