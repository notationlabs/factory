import { defineResource } from "@notation/resource";
import type { Secret } from "factory";
import {
  deleteSealedVariable,
  getSealedVariable,
  putSealedVariable,
} from "../lib/railway.ts";
import type { ProjectInstance } from "./project.ts";

type SealedVariableApi = {
  Key: { projectId: string; name: string };
  CreateParams: { projectId: string; name: string; source: Secret };
  UpdateParams: undefined;
  ReadResult: { fingerprint: string };
};

/**
 * One vault item, as a sealed shared variable the router and deployer
 * services reference. Sealed values are never shown or returned by the API,
 * so it's planned by `fingerprint`.
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
    source: { propertyType: "param", presence: "required", sensitive: true },
    fingerprint: { propertyType: "computed", presence: "required" },
  } as const)
  .defineOperations({
    create: async ({ projectId, name, source }) =>
      putSealedVariable({ projectId, name }, source),
    read: async (key) => getSealedVariable(key),
    update: async (key, _patch, { source }) => putSealedVariable(key, source),
    delete: async (key) => deleteSealedVariable(key),
  })
  .requireDependencies<{ project: ProjectInstance }>()
  .deriveParams(({ deps }) => ({ projectId: deps.project.output.id }));

export type SealedVariableInstance = InstanceType<typeof SealedVariable>;
