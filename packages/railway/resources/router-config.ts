import { mergeContributions, resource } from "@notation/resource";
import { type RouterConfig as Config, single } from "@notation/factory";
import * as v from "valibot";
import {
  deleteRouterConfig,
  readRouterConfig,
  writeRouterConfig,
} from "../lib/railway.ts";
import type { ServiceInstance } from "./service.ts";

type RouterConfigApi = {
  Key: { serviceId: string; path: string };
  CreateParams: {
    serviceId: string;
    path: string;
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
  type: "railway/router/RouterConfig",
  provider: "@notation/factory-railway",
});

const routerConfigSchema = routerConfig.defineSchema({
  serviceId: {
    propertyType: "param",
    presence: "required",
    secondaryKey: true,
    value: v.string(),
  },
  path: {
    propertyType: "param",
    presence: "required",
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
 * The router's config, as a JSON file on the router service's `/data`
 * volume. It is its own resource for the same reason as Cloudflare's: see
 * its RouterConfig.
 */
export const RouterConfig = routerConfigSchema
  .defineOperations({
    create: async ({ serviceId, path, ...config }) =>
      writeRouterConfig({ serviceId, path }, config),
    read: async (key) => readRouterConfig(key) as Promise<{}>,
    update: async (key, _patch, { serviceId: _s, path: _p, ...config }) =>
      writeRouterConfig(key, config),
    delete: async (key) => deleteRouterConfig(key),
  })
  .requireDependencies<{ service: ServiceInstance }>()
  .deriveParams(({ deps }) => ({ serviceId: deps.service.output.id }));

export type RouterConfigInstance = InstanceType<typeof RouterConfig>;
