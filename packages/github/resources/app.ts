import type { RouterApi } from "lightbox";
import { defineResource } from "@notation/resource";
import {
  createApp,
  readApp,
  requestAppChange,
  setWebhook,
} from "../lib/app.ts";
import {
  type GithubEvent,
  highestPermissions,
  type Permissions,
  union,
} from "../lib/permissions.ts";

/** One GitHub App, which backs a connection. Its channels' rules contribute the events and permissions they need. */
type AppApi = {
  Key: { slug: string };
  CreateParams: {
    name: string;
    org?: string;
    hookUrl: string;
    events?: GithubEvent[];
    permissions?: Permissions;
  };
  UpdateParams: {
    hookUrl: string;
    events?: GithubEvent[];
    permissions?: Permissions;
  };
  ReadResult: { slug: string; id: string; privateKey: string };
};

export const App = defineResource<AppApi>({ type: "github/apps/App" })
  .defineSchema({
    name: { propertyType: "param", presence: "required", immutable: true },
    org: { propertyType: "param", presence: "optional", immutable: true },
    hookUrl: { propertyType: "param", presence: "required" },
    events: { propertyType: "param", presence: "optional", collect: union },
    permissions: {
      propertyType: "param",
      presence: "optional",
      collect: highestPermissions,
    },
    slug: { propertyType: "computed", presence: "required", primaryKey: true },
    id: { propertyType: "computed", presence: "required" },
    privateKey: {
      propertyType: "computed",
      presence: "required",
      hidden: true,
    },
  } as const)
  .defineOperations({
    create: async (params) => createApp(params),
    read: async (key) => readApp(key),
    update: async (key, patch, params) => {
      if (patch.events !== undefined || patch.permissions !== undefined)
        await requestAppChange(key, {
          events: params.events,
          permissions: params.permissions,
        });
      await setWebhook(key, params.hookUrl);
    },
    delete: async () => {
      throw new Error(
        "GitHub has no API to delete an App: delete it on its settings page",
      );
    },
  })
  .requireDependencies<{ router: RouterApi }>()
  .deriveParams(({ deps }) => ({
    hookUrl: `${deps.router.output.url}/webhook`,
  }));

export type AppInstance = InstanceType<typeof App>;
