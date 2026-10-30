import { defineResource } from "@notation/resource";
import { createToken, deleteToken, getToken } from "../lib/api-token.ts";

type ApiTokenApi = {
  Key: { id: string };
  CreateParams: { name: string; permissions: string[] };
  UpdateParams: undefined;
  ReadResult: { id: string; value: string };
};

/** An account API token, e.g. the deployer's. Its value is only returned when it's created. */
export const ApiToken = defineResource<ApiTokenApi>({
  type: "cloudflare/tokens/ApiToken",
})
  .defineSchema({
    name: { propertyType: "param", presence: "required", immutable: true },
    /** Permission group names, e.g. `"Workers Scripts Write"`. */
    permissions: {
      propertyType: "param",
      presence: "required",
      immutable: true,
    },
    id: { propertyType: "computed", presence: "required", primaryKey: true },
    value: { propertyType: "computed", presence: "required", hidden: true },
  } as const)
  .defineOperations({
    create: async (params) => createToken(params),
    read: async (key) => getToken(key),
    delete: async (key) => deleteToken(key),
  });

export type ApiTokenInstance = InstanceType<typeof ApiToken>;
