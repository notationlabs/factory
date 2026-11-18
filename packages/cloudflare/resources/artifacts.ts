import { defineResource, ResourceNotFoundError } from "@notation/resource";
import * as v from "valibot";
import { createNamespace, deleteNamespace, getNamespace } from "../lib/artifacts.ts";

type ArtifactsNamespaceApi = {
  Key: { AccountId: string; Name: string };
  CreateParams: { AccountId: string; Name: string };
  UpdateParams: {};
  ReadResult: {};
};

const apiToken = () => {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("An Artifacts namespace needs CLOUDFLARE_API_TOKEN, with Artifacts Edit.");
  return token;
};

/**
 * An Artifacts namespace. Its name gets a random ending, since Artifacts
 * never frees a deleted namespace's name. Delete deletes its repos too.
 */
export const ArtifactsNamespace = defineResource<ArtifactsNamespaceApi>({
  type: "cloudflare/artifacts/Namespace",
  provider: "@notation/factory-cloudflare",
})
  .defineSchema({
    AccountId: {
      propertyType: "param",
      presence: "required",
      immutable: true,
      secondaryKey: true,
      value: v.string(),
    },
    Name: {
      propertyType: "param",
      presence: "required",
      immutable: true,
      primaryKey: true,
      value: v.string(),
      physicalName: { maxLength: 63 },
    },
  } as const)
  .defineOperations({
    create: async ({ AccountId, Name }) => {
      await createNamespace(apiToken(), AccountId, Name);
    },
    read: async ({ AccountId, Name }) => {
      if (!(await getNamespace(apiToken(), AccountId, Name))) throw new ResourceNotFoundError(`There's no Artifacts namespace ${Name}.`);
      return {};
    },
    update: async () => {},
    delete: async ({ AccountId, Name }) => deleteNamespace(apiToken(), AccountId, Name),
  });

export type ArtifactsNamespaceInstance = InstanceType<typeof ArtifactsNamespace>;
