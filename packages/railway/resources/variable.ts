import { defineResource } from "@notation/resource";
import {
  deleteSealedVariable,
  getSealedVariable,
  putSealedVariable,
} from "../lib/railway.ts";
import type { ProjectInstance } from "./project.ts";

type SealedVariableApi = {
  Key: { projectId: string; name: string };
  CreateParams: { projectId: string; name: string };
  UpdateParams: undefined;
  ReadResult: {};
};

/**
 * One vault item, as a sealed shared variable the router and deployer
 * services reference. Its params are its identity, and Railway holds its
 * value, which its API never returns.
 */
export const SealedVariable = defineResource<SealedVariableApi>({
  type: "railway/variables/SealedVariable",
})
  .defineSchema({
    projectId: {
      propertyType: "param",
      presence: "required",
      secondaryKey: true,
    },
    name: { propertyType: "param", presence: "required", primaryKey: true },
  } as const)
  .defineOperations({
    create: async (params) => putSealedVariable(params),
    read: async (key) => getSealedVariable(key),
    delete: async (key) => deleteSealedVariable(key),
  })
  .requireDependencies<{ project: ProjectInstance }>()
  .deriveParams(({ deps }) => ({ projectId: deps.project.output.id }));

export type SealedVariableInstance = InstanceType<typeof SealedVariable>;
