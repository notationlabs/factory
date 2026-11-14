import { PROMPT_SOURCE } from "@notation/core";
import { resource, ResourceNotFoundError } from "@notation/resource";
import { getValue } from "@notation/std/sources";
import * as v from "valibot";
import {
  deleteSealedVariable,
  findSealedVariable,
  putSealedVariable,
} from "../lib/railway.ts";
import type { ProjectInstance } from "./project.ts";

const valueFromSchema = v.object({
  /** The id of the secret's declaration, which `getValue` takes. */
  Secret: v.string(),
  /** The name of the source, such as `infisical`, or `prompt`. */
  Source: v.string(),
  /** The key that the source is asked for. */
  Key: v.optional(v.string()),
  /** The source's version of the key. It is never derived from the value. */
  Version: v.optional(v.string()),
});

/** Where a sealed variable's value comes from. It never holds the value. */
export type SealedVariableValueFrom = v.InferOutput<typeof valueFromSchema>;

type SealedVariableKey = {
  projectId: string;
  environmentId: string;
  name: string;
};

type SealedVariableParams = SealedVariableKey & {
  valueFrom: SealedVariableValueFrom;
};

type SealedVariableApi = {
  Key: SealedVariableKey;
  CreateParams: SealedVariableParams;
  UpdateParams: Pick<SealedVariableParams, "valueFrom">;
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
  valueFrom: {
    propertyType: "param",
    presence: "required",
    value: valueFromSchema,
  },
} as const);

/**
 * Writes the variable's value, fetched with `getValue`. A variable whose
 * value comes from the prompt is written only when it is missing, so that a
 * value set with `notation secret set` is kept.
 */
async function writeValue(params: SealedVariableParams): Promise<void> {
  const { valueFrom, ...key } = params;
  if (valueFrom.Source === PROMPT_SOURCE && (await findSealedVariable(key))) {
    return;
  }
  const value = await getValue(valueFrom.Secret);
  await putSealedVariable(key, value.unwrap());
}

/**
 * One vault secret, as a sealed shared variable in the project's
 * environment, which the router and deployer services reference. Its record
 * holds where the variable is and where its value comes from. Railway holds
 * the value, and its API never returns it.
 *
 * Create writes the value, and so does an update when `valueFrom` changes,
 * such as when the source has a new version. Read only checks that the
 * variable exists, so a deleted one shows as drift, which the next deploy
 * creates again.
 */
export const SealedVariable = sealedVariableSchema
  .defineOperations({
    create: async (params) => {
      await writeValue(params);
    },
    read: async (key) => {
      if (!(await findSealedVariable(key))) {
        throw new ResourceNotFoundError(
          "No sealed variable in the environment has the name",
        );
      }
      return {};
    },
    update: async (_key, patch, params) => {
      if (patch.valueFrom) await writeValue(params);
    },
    delete: async (key) => deleteSealedVariable(key),
  })
  .requireDependencies<{ project: ProjectInstance }>()
  .deriveParams(({ deps }) => ({
    projectId: deps.project.output.id,
    environmentId: deps.project.output.environmentId,
  }));

export type SealedVariableInstance = InstanceType<typeof SealedVariable>;
