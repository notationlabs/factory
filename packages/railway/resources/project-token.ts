import { resource } from "@notation/resource";
import * as v from "valibot";
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
  ReadResult: { id: string };
};

const projectToken = resource<ProjectTokenApi>({
  type: "railway/projects/ProjectToken",
  provider: "@notation/factory-railway",
});

const projectTokenSchema = projectToken.defineSchema({
  projectId: {
    propertyType: "param",
    presence: "required",
    immutable: true,
    value: v.string(),
  },
  environmentId: {
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
  id: {
    propertyType: "computed",
    presence: "required",
    primaryKey: true,
    value: v.string(),
  },
  /** The token's value, which Railway returns only when it creates the token. */
  value: { propertyType: "credential", value: v.string() },
} as const);

/**
 * A token scoped to one environment of the hub's project, such as the
 * deployer's. Its value is the credential `value`. Railway has no API that
 * gives a token a new value.
 */
export const ProjectToken = projectTokenSchema
  .defineOperations({
    create: async (params) => createProjectToken(params),
    rotateManually: {
      value:
        "Create a token in the project's settings, under Tokens, and delete the old one.",
    },
    read: async (key) => getProjectToken(key),
    delete: async (key) => deleteProjectToken(key),
  })
  .requireDependencies<{ project: ProjectInstance }>()
  .deriveParams(({ deps }) => ({
    projectId: deps.project.output.id,
    environmentId: deps.project.output.environmentId,
  }));

export type ProjectTokenInstance = InstanceType<typeof ProjectToken>;
