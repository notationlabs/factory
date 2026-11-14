import { mergeContributions, resource } from "@notation/resource";
import * as v from "valibot";
import {
  createService,
  deleteService,
  getService,
  updateService,
} from "../lib/railway.ts";
import type { ProjectInstance } from "./project.ts";

type ServiceApi = {
  Key: { id: string };
  CreateParams: {
    projectId: string;
    name: string;
    public?: boolean;
    volume?: string;
    sleep?: boolean;
    vars?: Record<string, string>;
  };
  UpdateParams: {
    public?: boolean;
    volume?: string;
    sleep?: boolean;
    vars?: Record<string, string>;
  };
  ReadResult: { id: string; Url: string };
};

const service = resource<ServiceApi>({
  type: "railway/services/Service",
  provider: "@notation/factory-railway",
});

const serviceSchema = service.defineSchema({
  projectId: {
    propertyType: "param",
    presence: "required",
    immutable: true,
    value: v.string(),
  },
  name: {
    propertyType: "param",
    presence: "required",
    immutable: true,
    value: v.string(),
  },
  /** Gets a public domain. Otherwise it's reached on the private network. */
  public: { propertyType: "param", presence: "optional", value: v.boolean() },
  /** Mount path of its persistent volume. */
  volume: { propertyType: "param", presence: "optional", value: v.string() },
  /** Scales to zero when idle. */
  sleep: { propertyType: "param", presence: "optional", value: v.boolean() },
  /**
   * The service's variables. A value may be a Railway reference such as
   * `${{shared.NAME}}`, which Railway resolves when it deploys the service.
   */
  vars: {
    propertyType: "param",
    presence: "optional",
    value: v.record(v.string(), v.string()),
    collect: mergeContributions,
  },
  id: {
    propertyType: "computed",
    presence: "required",
    primaryKey: true,
    value: v.string(),
  },
  Url: { propertyType: "computed", presence: "required", value: v.string() },
} as const);

/** A service in the hub's project, e.g. the router or the deployer. */
export const Service = serviceSchema
  .defineOperations({
    create: async (params) => createService(params),
    read: async (key) => getService(key),
    update: async (key, _patch, params) => updateService(key, params),
    delete: async (key) => deleteService(key),
  })
  .requireDependencies<{ project: ProjectInstance }>()
  .deriveParams(({ deps }) => ({ projectId: deps.project.output.id }));

export type ServiceInstance = InstanceType<typeof Service>;
