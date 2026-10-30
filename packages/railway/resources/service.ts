import { defineResource, mergeRecords } from "@notation/resource";
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
    /** Gets a public domain. Otherwise it's reached on the private network. */
    public?: boolean;
    /** Mount path of its persistent volume. */
    volume?: string;
    /** Scales to zero when idle. */
    sleep?: boolean;
    vars?: Record<string, unknown>;
    /** Sealed shared variables it references, as `${{shared.NAME}}`: each variable's name in the service, and the shared variable it reads. */
    secrets?: Record<string, string>;
  };
  UpdateParams: {
    public?: boolean;
    volume?: string;
    sleep?: boolean;
    vars?: Record<string, unknown>;
    /** Sealed shared variables it references, as `${{shared.NAME}}`: each variable's name in the service, and the shared variable it reads. */
    secrets?: Record<string, string>;
  };
  ReadResult: { id: string; url: string };
};

/** A service in the hub's project, e.g. the router or the deployer. */
export const Service = defineResource<ServiceApi>({
  type: "railway/services/Service",
})
  .defineSchema({
    projectId: {
      propertyType: "param",
      presence: "required",
      immutable: true,
    },
    name: { propertyType: "param", presence: "required", immutable: true },
    public: { propertyType: "param", presence: "optional" },
    volume: { propertyType: "param", presence: "optional" },
    sleep: { propertyType: "param", presence: "optional" },
    vars: { propertyType: "param", presence: "optional" },
    secrets: {
      propertyType: "param",
      presence: "optional",
      collect: mergeRecords,
    },
    id: { propertyType: "computed", presence: "required", primaryKey: true },
    url: { propertyType: "computed", presence: "required" },
  } as const)
  .defineOperations({
    create: async (params) => createService(params),
    read: async (key) => getService(key),
    update: async (key, _patch, params) => updateService(key, params),
    delete: async (key) => deleteService(key),
  })
  .requireDependencies<{ project: ProjectInstance }>()
  .deriveParams(({ deps }) => ({ projectId: deps.project.output.id }));

export type ServiceInstance = InstanceType<typeof Service>;
