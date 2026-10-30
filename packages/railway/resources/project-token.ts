import { defineResource } from "@notation/resource";
import {
  createProjectToken,
  deleteProjectToken,
  getProjectToken,
} from "../lib/railway.ts";
import type { ProjectInstance } from "./project.ts";

type ProjectTokenApi = {
  Key: { id: string };
  CreateParams: { projectId: string; environmentId: string; name: string };
  UpdateParams: undefined;
  ReadResult: { id: string; value: string };
};

/** A token scoped to one environment of the hub's project, e.g. the deployer's. Its value is only returned when it's created. */
export const ProjectToken = defineResource<ProjectTokenApi>({
  type: "railway/projects/ProjectToken",
})
  .defineSchema({
    projectId: {
      propertyType: "param",
      presence: "required",
      immutable: true,
    },
    environmentId: {
      propertyType: "param",
      presence: "required",
      immutable: true,
    },
    name: { propertyType: "param", presence: "required", immutable: true },
    id: { propertyType: "computed", presence: "required", primaryKey: true },
    value: { propertyType: "computed", presence: "required", hidden: true },
  } as const)
  .defineOperations({
    create: async (params) => createProjectToken(params),
    read: async (key) => getProjectToken(key),
    delete: async (key) => deleteProjectToken(key),
  })
  .requireDependencies<{ project: ProjectInstance }>()
  .deriveParams(({ deps }) => ({
    projectId: deps.project.output.id,
    environmentId: deps.project.output.environmentId,
  }));

export type ProjectTokenInstance = InstanceType<typeof ProjectToken>;
