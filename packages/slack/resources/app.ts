import { defineResource } from "@notation/resource";
import type { RouterApi } from "lightbox";
import { createApp, readApp, setRequestUrl } from "../lib/app.ts";

/** One Slack app, which backs a connection. Its Events API request URL is the router's webhook. */
type AppApi = {
  Key: { appId: string };
  CreateParams: { name: string; workspace: string; requestUrl: string };
  UpdateParams: { requestUrl: string };
  ReadResult: { appId: string };
};

export const App = defineResource<AppApi>({ type: "slack/apps/App" })
  .defineSchema({
    name: { propertyType: "param", presence: "required", immutable: true },
    workspace: { propertyType: "param", presence: "required", immutable: true },
    requestUrl: { propertyType: "param", presence: "required" },
    appId: { propertyType: "computed", presence: "required", primaryKey: true },
  } as const)
  .defineOperations({
    create: async (params) => createApp(params),
    read: async (key) => readApp(key),
    update: async (key, _patch, params) => setRequestUrl(key, params.requestUrl),
    delete: async () => {
      throw new Error(
        "The Slack app is protected: delete it on its settings page",
      );
    },
  })
  .requireDependencies<{ router: RouterApi }>()
  .deriveParams(({ deps }) => ({
    requestUrl: `${deps.router.output.url}/webhook`,
  }));

export type AppInstance = InstanceType<typeof App>;
