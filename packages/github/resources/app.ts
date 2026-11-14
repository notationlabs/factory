import type { RouterApi } from "@notation/factory";
import { defineResource } from "@notation/resource";
import * as v from "valibot";
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
  ReadResult: { slug: string; id: string };
};

const githubEvent = v.picklist([
  "issues",
  "issue_comment",
  "push",
  "pull_request",
  "pull_request_review_comment",
] satisfies GithubEvent[]);

const permission = v.picklist(["read", "write"]);

const permissions = v.partial(
  v.object({
    actions_variables: permission,
    contents: permission,
    issues: permission,
    metadata: permission,
    pull_requests: permission,
  }),
);

export const App = defineResource<AppApi>({
  type: "github/apps/App",
  provider: "@notation/factory-github",
})
  .defineSchema({
    name: {
      propertyType: "param",
      presence: "required",
      immutable: true,
      value: v.string(),
    },
    org: {
      propertyType: "param",
      presence: "optional",
      immutable: true,
      value: v.string(),
    },
    hookUrl: { propertyType: "param", presence: "required", value: v.string() },
    events: {
      propertyType: "param",
      presence: "optional",
      value: v.array(githubEvent),
      collect: union,
    },
    permissions: {
      propertyType: "param",
      presence: "optional",
      value: permissions,
      collect: highestPermissions,
    },
    slug: {
      propertyType: "computed",
      presence: "required",
      primaryKey: true,
      value: v.string(),
    },
    id: { propertyType: "computed", presence: "required", value: v.string() },
  } as const)
  .defineOperations({
    create: async (params) => createApp(params),
    read: async (key) => readApp(key),
    update: async (key, patch, params) => {
      if (patch.events !== undefined || patch.permissions !== undefined) {
        await requestAppChange(key, {
          events: params.events,
          permissions: params.permissions,
        });
      }
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
    hookUrl: `${deps.router.output.Url}/webhook`,
  }));

export type AppInstance = InstanceType<typeof App>;
