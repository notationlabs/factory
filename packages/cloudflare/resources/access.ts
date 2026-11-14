import { resource } from "@notation/resource";
import type { workers } from "@notation/cloudflare/resources";
import * as v from "valibot";
import {
  createApplication,
  deleteApplication,
  getApplication,
  updateApplication,
} from "../lib/access.ts";

type AccessApplicationApi = {
  Key: { AccountId: string; ApplicationId: string };
  CreateParams: {
    AccountId: string;
    Name: string;
    Domain: string;
    Emails: string[];
  };
  UpdateParams: { Domain: string; Emails: string[] };
  ReadResult: { Aud: string };
};

const accessApplication = resource<AccessApplicationApi>({
  type: "cloudflare/access/AccessApplication",
  provider: "@notation/factory-cloudflare",
});

const accessApplicationSchema = accessApplication.defineSchema({
  AccountId: {
    propertyType: "param",
    presence: "required",
    immutable: true,
    secondaryKey: true,
    value: v.string(),
  },
  ApplicationId: {
    propertyType: "computed",
    presence: "required",
    primaryKey: true,
    value: v.string(),
  },
  Name: {
    propertyType: "param",
    presence: "required",
    immutable: true,
    value: v.string(),
  },
  Domain: {
    propertyType: "param",
    presence: "required",
    value: v.string(),
  },
  Emails: {
    propertyType: "param",
    presence: "required",
    value: v.array(v.string()),
  },
  Aud: {
    propertyType: "computed",
    presence: "required",
    value: v.string(),
  },
} as const);

/** An Access application in front of the router's admin routes. The router verifies Access's token against `Aud`. */
export const AccessApplication = accessApplicationSchema
  .defineOperations({
    create: async (params) => createApplication(params),
    read: async (key) => getApplication(key),
    update: async (key, _patch, { Domain, Emails }) =>
      updateApplication(key, { Domain, Emails }),
    delete: async (key) => deleteApplication(key),
  })
  .requireDependencies<{ router: workers.WorkerSubdomainInstance }>()
  .deriveParams(({ deps }) => {
    const url = new URL(deps.router.output.Url);
    return {
      AccountId: deps.router.output.AccountId,
      Domain: `${url.host}/admin`,
    };
  });

export type AccessApplicationInstance = InstanceType<typeof AccessApplication>;
