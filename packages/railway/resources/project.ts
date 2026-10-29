import { defineResource } from "@notation/resource";
import { createProject, deleteProject, getProject } from "../lib/railway.ts";

type ProjectApi = {
  Key: { id: string };
  CreateParams: { name: string };
  UpdateParams: undefined;
  ReadResult: { id: string; name: string };
};

/** The hub's Railway project: the router, the deployer and every outpost are services in it. */
export const Project = defineResource<ProjectApi>({
  type: "railway/projects/Project",
})
  .defineSchema({
    name: { propertyType: "param", presence: "required", immutable: true },
    id: { propertyType: "computed", presence: "required", primaryKey: true },
  } as const)
  .defineOperations({
    create: async (params) => createProject(params),
    read: async (key) => getProject(key),
    delete: async (key) => deleteProject(key),
  });

export type ProjectInstance = InstanceType<typeof Project>;
