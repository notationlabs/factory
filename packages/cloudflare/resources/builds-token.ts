import { defineResource } from "@notation/resource";
import * as v from "valibot";
import { askForBuildsToken } from "../lib/builds-token.ts";

type BuildsTokenApi = {
  Key: { TokenId: string };
  CreateParams: { AccountId: string; Name: string };
  UpdateParams: {};
  ReadResult: {};
};

/**
 * A user API token that the deployer builds outpost Workers with, since the
 * Workers Builds API refuses account tokens. Create asks you for it in the
 * browser.
 */
export const BuildsToken = defineResource<BuildsTokenApi>({
  type: "cloudflare/builds/BuildsToken",
  provider: "@notation/factory-cloudflare",
})
  .defineSchema({
    AccountId: {
      propertyType: "param",
      presence: "required",
      immutable: true,
      value: v.string(),
    },
    Name: {
      propertyType: "param",
      presence: "required",
      immutable: true,
      value: v.string(),
    },
    TokenId: {
      propertyType: "computed",
      presence: "required",
      primaryKey: true,
      value: v.string(),
    },
    /** The token. Cloudflare shows it once, when you create it. */
    Value: { propertyType: "credential", value: v.string() },
  } as const)
  .defineOperations({
    create: async ({ AccountId, Name }) => askForBuildsToken({ name: Name, accountId: AccountId }),
    rotateManually: {
      Value: "Roll the token on https://dash.cloudflare.com/profile/api-tokens, or create another.",
    },
    read: async () => ({}),
    update: async () => {},
    delete: async ({ TokenId }) => {
      console.error(`Delete the deployer's builds token ${TokenId} on https://dash.cloudflare.com/profile/api-tokens`);
    },
  });

export type BuildsTokenInstance = InstanceType<typeof BuildsToken>;
