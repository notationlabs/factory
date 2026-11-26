import { defineResource } from "@notation/resource";
import * as v from "valibot";
import {
  createApp,
  readApp,
  requestAppChange,
  requestCallbackUrl,
  requestAppDeletion,
} from "../lib/app.ts";
import {
  type GithubEvent,
  highestPermissions,
  type Permissions,
  permissionsSchema,
  union,
} from "../lib/permissions.ts";

/** One GitHub App, which backs a connection. Its channels' rules contribute the events and permissions they need. */
type AppApi = {
  Key: { id: string };
  CreateParams: {
    name: string;
    org?: string;
    hookUrl: string;
    restartUrl?: string;
    events?: GithubEvent[];
    permissions?: Permissions;
  };
  UpdateParams: {
    hookUrl: string;
    restartUrl?: string;
    events?: GithubEvent[];
    permissions?: Permissions;
  };
  ReadResult: { id: string; clientId: string };
};

const githubEvent = v.picklist([
  "issues",
  "issue_comment",
  "push",
  "pull_request",
  "pull_request_review_comment",
] satisfies GithubEvent[]);

export const App = defineResource<AppApi>({
  type: "github/apps/App",
  provider: "@notation/factory-github",
})
  .defineSchema({
    /**
     * The name the manifest flow suggests for the App. GitHub owns the name
     * after that, and the App keeps working when it's renamed.
     */
    name: {
      propertyType: "param",
      presence: "required",
      immutable: true,
      volatile: true,
      value: v.string(),
    },
    org: {
      propertyType: "param",
      presence: "optional",
      immutable: true,
      value: v.string(),
    },
    hookUrl: { propertyType: "param", presence: "required", value: v.string() },
    /** The router's page that the sign-in of a lost run's restart link returns to, which the App allows as a callback URL. */
    restartUrl: { propertyType: "param", presence: "optional", value: v.string() },
    events: {
      propertyType: "param",
      presence: "optional",
      value: v.array(githubEvent),
      collect: union,
    },
    permissions: {
      propertyType: "param",
      presence: "optional",
      value: permissionsSchema,
      collect: highestPermissions,
    },
    id: {
      propertyType: "computed",
      presence: "required",
      primaryKey: true,
      value: v.string(),
    },
    /** The App's client id, which GitHub's sign-in page names the App by. */
    clientId: { propertyType: "computed", presence: "required", value: v.string() },
    /**
     * The App's private key, which GitHub returns once, when the manifest
     * flow creates the App. GitHub has no API that makes another.
     */
    privateKey: { propertyType: "credential", value: v.string() },
    /**
     * The App's client secret, which the router uses to sign operators in.
     * The manifest flow returns it when it creates the App.
     */
    clientSecret: { propertyType: "credential", value: v.string() },
  } as const)
  .defineOperations({
    create: async (params) => createApp(params),
    rotateManually: {
      privateKey:
        "Generate a private key on the App's settings page, under Private keys.",
      clientSecret:
        "Generate a client secret on the App's settings page, under Client secrets.",
    },
    read: async (key) => readApp(key),
    update: async (key, patch, params) => {
      if (patch.events !== undefined || patch.permissions !== undefined) {
        await requestAppChange({ ...key, org: params.org }, {
          events: params.events,
          permissions: params.permissions,
        });
      }
      if (patch.restartUrl !== undefined) await requestCallbackUrl({ ...key, org: params.org }, patch.restartUrl);
      // A new hookUrl reaches GitHub through the router's sync, which signs
      // in as the App with its private key.
    },
    // GitHub has no API to delete an App.
    delete: async (key, state) => requestAppDeletion({ ...key, org: state.org }),
  });

export type AppInstance = InstanceType<typeof App>;
