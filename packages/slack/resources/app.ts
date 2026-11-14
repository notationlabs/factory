import { defineResource } from "@notation/resource";
import type { RouterApi } from "@notation/factory";
import * as v from "valibot";
import { createApp, readApp, setRequestUrl } from "../lib/app.ts";

/** One Slack app, which backs a connection. Its Events API request URL is the router's webhook. */
type AppApi = {
  Key: { appId: string };
  CreateParams: { name: string; workspace: string; requestUrl: string };
  UpdateParams: { requestUrl: string };
  ReadResult: { appId: string };
};

export const App = defineResource<AppApi>({
  type: "slack/apps/App",
  provider: "@notation/factory-slack",
})
  .defineSchema({
    name: {
      propertyType: "param",
      presence: "required",
      immutable: true,
      value: v.string(),
    },
    workspace: {
      propertyType: "param",
      presence: "required",
      immutable: true,
      value: v.string(),
    },
    requestUrl: {
      propertyType: "param",
      presence: "required",
      value: v.string(),
    },
    appId: {
      propertyType: "computed",
      presence: "required",
      primaryKey: true,
      value: v.string(),
    },
  } as const)
  .defineOperations({
    create: async (params) => createApp(params),
    read: async (key) => readApp(key),
    update: async (key, _patch, params) =>
      setRequestUrl(key, params.requestUrl),
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
