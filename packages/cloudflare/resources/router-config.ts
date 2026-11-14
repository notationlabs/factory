import { mergeContributions, resource } from "@notation/resource";
import { type RouterConfig as Config, single } from "@notation/factory";
import type { kv } from "@notation/cloudflare/resources";
import * as v from "valibot";
import { deleteValue, getValue, putValue } from "../lib/kv.ts";

type RouterConfigApi = {
  Key: { AccountId: string; NamespaceId: string; Key: string };
  CreateParams: {
    AccountId: string;
    NamespaceId: string;
    Key: string;
    connections?: Config["connections"];
    codeHost?: Config["codeHost"];
    operators?: Config["operators"];
  };
  UpdateParams: undefined;
  ReadResult: undefined;
};

const connectionEntry = v.object({
  provider: v.string(),
  source: v.string(),
  credentials: v.record(v.string(), v.string()),
});

const codeHostEntry = v.object({
  provider: v.string(),
  connection: v.string(),
  allow: v.array(
    v.object({ owner: v.string(), repo: v.optional(v.string()) }),
  ),
});

const operatorsEntry = v.looseObject({ provider: v.string() });

const routerConfig = resource<RouterConfigApi>({
  type: "cloudflare/kv/RouterConfig",
  provider: "@notation/factory-cloudflare",
});

const routerConfigSchema = routerConfig.defineSchema({
  AccountId: {
    propertyType: "param",
    presence: "required",
    immutable: true,
    secondaryKey: true,
    value: v.string(),
  },
  NamespaceId: {
    propertyType: "param",
    presence: "required",
    immutable: true,
    secondaryKey: true,
    value: v.string(),
  },
  Key: {
    propertyType: "param",
    presence: "required",
    immutable: true,
    primaryKey: true,
    value: v.string(),
  },
  connections: {
    propertyType: "param",
    presence: "optional",
    value: v.record(v.string(), connectionEntry),
    collect: mergeContributions,
  },
  codeHost: {
    propertyType: "param",
    presence: "optional",
    value: codeHostEntry,
    collect: single,
  },
  operators: {
    propertyType: "param",
    presence: "optional",
    value: operatorsEntry,
    collect: single,
  },
} as const);

/**
 * The router's config, as one KV entry the Worker reads. Its own resource,
 * not a param of the Worker: an App needs the Worker's URL and its connection
 * contributes the App's id, so as a Worker param it would close a cycle.
 */
export const RouterConfig = routerConfigSchema
  .defineOperations({
    create: async ({ AccountId, NamespaceId, Key, ...config }) => {
      await putValue({ AccountId, NamespaceId, Key }, config);
    },
    read: async (key) => getValue(key) as Promise<{}>,
    update: async (key, _patch, params) => {
      const { AccountId: _a, NamespaceId: _n, Key: _k, ...config } = params;
      await putValue(key, config);
    },
    delete: async (key) => deleteValue(key),
  })
  .requireDependencies<{ kv: kv.KVNamespaceInstance }>()
  .deriveParams(({ deps }) => ({
    AccountId: deps.kv.output.AccountId,
    NamespaceId: deps.kv.output.NamespaceId,
  }));

export type RouterConfigInstance = InstanceType<typeof RouterConfig>;
