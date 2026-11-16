import { resource, ResourceNotFoundError } from "@notation/resource";
import * as v from "valibot";
import {
  deleteSealedVariable,
  findSealedVariable,
  putSealedVariable,
} from "../lib/railway.ts";
import type { ProjectInstance } from "./project.ts";

type SealedVariableKey = {
  projectId: string;
  environmentId: string;
  name: string;
};

type SealedVariableParams = SealedVariableKey & {
  /**
   * The value, from a credential of another resource, such as
   * `source.credentials.value`. State holds a marker in its place.
   */
  value: string;
};

type SealedVariableApi = {
  Key: SealedVariableKey;
  CreateParams: SealedVariableParams;
  UpdateParams: Pick<SealedVariableParams, "value">;
  ReadResult: {};
};

const sealedVariable = resource<SealedVariableApi>({
  type: "railway/variables/SealedVariable",
  provider: "@notation/factory-railway",
});

const sealedVariableSchema = sealedVariable.defineSchema({
  projectId: {
    propertyType: "param",
    presence: "required",
    immutable: true,
    secondaryKey: true,
    value: v.string(),
  },
  environmentId: {
    propertyType: "param",
    presence: "required",
    immutable: true,
    secondaryKey: true,
    value: v.string(),
  },
  name: {
    propertyType: "param",
    presence: "required",
    immutable: true,
    primaryKey: true,
    value: v.pipe(v.string(), v.nonEmpty()),
  },
  value: {
    propertyType: "param",
    presence: "required",
    sensitive: true,
    value: v.string(),
  },
} as const);

/**
 * One vault secret, as a sealed shared variable in the project's
 * environment, which the router and deployer services reference. Its record
 * holds where the variable is, and never the value. Railway holds the value,
 * and its API never returns it.
 *
 * Create writes the value, and so does an update when the credential has a
 * new version. Read only checks that the variable exists, so a deleted one
 * shows as drift, which the next deploy creates again.
 */
export const SealedVariable = sealedVariableSchema
  .defineOperations({
    create: async ({ value, ...key }) => {
      await putSealedVariable(key, value);
    },
    read: async (key) => {
      if (!(await findSealedVariable(key))) {
        throw new ResourceNotFoundError(
          "No sealed variable in the environment has the name",
        );
      }
      return {};
    },
    // `value` is undefined unless the credential has a new version.
    update: async (key, patch) => {
      if (patch.value !== undefined) await putSealedVariable(key, patch.value);
    },
    delete: async (key) => deleteSealedVariable(key),
  })
  .requireDependencies<{ project: ProjectInstance }>()
  .deriveParams(({ deps }) => ({
    projectId: deps.project.output.id,
    environmentId: deps.project.output.environmentId,
  }));

export type SealedVariableInstance = InstanceType<typeof SealedVariable>;
