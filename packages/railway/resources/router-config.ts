import { defineResource, mergeContributions } from "@notation/resource";
import { type RouterConfig as Config, single } from "@notation/factory";
import {
  deleteRouterConfig,
  readRouterConfig,
  writeRouterConfig,
} from "../lib/railway.ts";
import type { ServiceInstance } from "./service.ts";

/** The router's config, as a JSON file on the router service's `/data` volume. Its own resource for the same reason as Cloudflare's: see its RouterConfig. */
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

export const RouterConfig = defineResource<RouterConfigApi>({
  type: "railway/router/RouterConfig",
})
  .defineSchema({
    serviceId: {
      propertyType: "param",
      presence: "required",
      secondaryKey: true,
    },
    path: { propertyType: "param", presence: "required", primaryKey: true },
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
