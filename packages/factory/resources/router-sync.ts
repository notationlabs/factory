import { randomUUID } from "node:crypto";
import { resource } from "@notation/resource";
import * as v from "valibot";
import { SYNC_HEADER, signSync } from "../router/sync.ts";

type RouterSyncApi = {
  Key: { SyncId: string };
  CreateParams: { Url: string; Config: string; SyncKey: string; DeployId: string };
  UpdateParams: { Url: string; Config: string; SyncKey: string; DeployId: string };
  ReadResult: {};
};

const routerSync = resource<RouterSyncApi>({
  type: "factory/router/Sync",
  provider: "@notation/factory",
});

const routerSyncSchema = routerSync.defineSchema({
  Url: { propertyType: "param", presence: "required", value: v.string() },
  /** The router's config, as JSON. */
  Config: { propertyType: "param", presence: "required", value: v.string() },
  /** The key that the router checks the sync request's signature with. */
  SyncKey: { propertyType: "param", presence: "required", sensitive: true, value: v.string() },
  /** A new value on every deploy, so that every deploy syncs. */
  DeployId: { propertyType: "param", presence: "required", value: v.string() },
  SyncId: {
    propertyType: "computed",
    presence: "required",
    primaryKey: true,
    value: v.string(),
  },
} as const);

const sync = async (url: string, syncKey: string) => {
  const target = new URL("/sync", url);
  const response = await fetch(target, {
    method: "POST",
    headers: { [SYNC_HEADER]: await signSync(syncKey, target.origin) },
  });
  if (!response.ok) {
    throw new Error(
      `The router's sync at ${url} failed with ${response.status}: ${await response.text()}`,
    );
  }
  console.error("The router is deploying the hub's repos again. Run `factory infra status` to see how the deploys went.");
};

const announce = (url: string) =>
  console.error(`The router is at ${url}. Set router in factory.config.ts to this URL, so that factory can reach the hub.`);

/**
 * Calls the router's `/sync` on every deploy. The router points each
 * connection's platform at itself (for GitHub, the App's webhook URL and
 * secret), and then deploys every repo again without making deploy wait.
 * Prints the router's URL when it's new.
 */
export const RouterSync = routerSyncSchema.defineOperations({
  create: async (params) => {
    await sync(params.Url, params.SyncKey);
    announce(params.Url);
    return { SyncId: randomUUID() };
  },
  update: async (_key, patch, params) => {
    await sync(params.Url, params.SyncKey);
    if (patch.Url !== undefined) announce(params.Url);
  },
  read: async (key) => key,
  delete: async () => {},
});
