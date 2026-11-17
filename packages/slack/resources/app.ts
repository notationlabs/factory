import { defineResource } from "@notation/resource";
import * as v from "valibot";
import { createApp, readApp, setRequestUrl } from "../lib/app.ts";

/** One Slack app, which backs a connection. Its Events API request URL is the connection's webhook path on the router. */
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
    /** The bot token, which installing the app to the workspace issues. */
    botToken: { propertyType: "credential", value: v.string() },
    /** The secret that Slack signs the app's requests with. */
    signingSecret: { propertyType: "credential", value: v.string() },
  } as const)
  .defineOperations({
    create: async (params) => createApp(params),
    rotateManually: {
      botToken:
        "Copy the Bot User OAuth Token from the app's OAuth & Permissions page.",
      signingSecret:
        "Regenerate the Signing Secret on the app's Basic Information page.",
    },
    read: async (key) => readApp(key),
    update: async (key, _patch, params) =>
      setRequestUrl(key, params.requestUrl),
    delete: async () => {
      throw new Error(
        "The Slack app is protected: delete it on its settings page",
      );
    },
  });

export type AppInstance = InstanceType<typeof App>;
