import { defineResource } from "@notation/resource";
import type { RouterApi } from "factory";
import {
  createApplication,
  deleteApplication,
  getApplication,
  updateApplication,
} from "../lib/access.ts";

type AccessApplicationApi = {
  Key: { id: string };
  CreateParams: { name: string; domain: string; emails: string[] };
  UpdateParams: { domain: string; emails: string[] };
  ReadResult: { id: string; aud: string };
};

/** An Access application in front of the router's admin routes. The router verifies Access's token against `aud`. */
export const AccessApplication = defineResource<AccessApplicationApi>({
  type: "cloudflare/access/Application",
})
  .defineSchema({
    name: { propertyType: "param", presence: "required", immutable: true },
    domain: { propertyType: "param", presence: "required" },
    emails: { propertyType: "param", presence: "required" },
    id: { propertyType: "computed", presence: "required", primaryKey: true },
    aud: { propertyType: "computed", presence: "required" },
  } as const)
  .defineOperations({
    create: async (params) => createApplication(params),
    read: async (key) => getApplication(key),
    update: async (key, _patch, { domain, emails }) =>
      updateApplication(key, { domain, emails }),
    delete: async (key) => deleteApplication(key),
  })
  .requireDependencies<{ router: RouterApi }>()
  .deriveParams(({ deps }) => ({
    domain: `${deps.router.output.url}/admin`,
  }));

export type AccessApplicationInstance = InstanceType<typeof AccessApplication>;
