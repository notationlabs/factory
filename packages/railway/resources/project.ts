import { resource } from "@notation/resource";
import * as v from "valibot";
import { createProject, deleteProject, getProject } from "../lib/railway.ts";

type ProjectApi = {
  Key: { id: string };
  CreateParams: { name: string };
  UpdateParams: undefined;
  ReadResult: { id: string; name: string; environmentId: string };
};

const project = resource<ProjectApi>({
  type: "railway/projects/Project",
  provider: "@notation/factory-railway",
});

const projectSchema = project.defineSchema({
  name: {
    propertyType: "param",
    presence: "required",
    immutable: true,
    value: v.string(),
  },
  id: {
    propertyType: "computed",
    presence: "required",
    primaryKey: true,
    value: v.string(),
  },
  /** Its production environment, which the hub's services run in. */
  environmentId: {
    propertyType: "computed",
    presence: "required",
    value: v.string(),
  },
} as const);

/** The hub's Railway project: the router, the deployer and every outpost are services in it. */
export const Project = projectSchema.defineOperations({
  create: async (params) => createProject(params),
  read: async (key) => getProject(key),
  delete: async (key) => deleteProject(key),
});

export type ProjectInstance = InstanceType<typeof Project>;
