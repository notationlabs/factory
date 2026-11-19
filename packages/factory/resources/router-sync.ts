import { randomUUID } from "node:crypto";
import { resource } from "@notation/resource";
import * as v from "valibot";

type RouterSyncApi = {
  Key: { SyncId: string };
  CreateParams: { Url: string; Config: string };
  UpdateParams: { Url: string; Config: string };
  ReadResult: {};
};

const routerSync = resource<RouterSyncApi>({
  type: "factory/router/Sync",
  provider: "@notation/factory",
});

const routerSyncSchema = routerSync.defineSchema({
  Url: { propertyType: "param", presence: "required", value: v.string() },
  /** The router's config, as JSON. A change to it syncs again. */
  Config: { propertyType: "param", presence: "required", value: v.string() },
  SyncId: {
    propertyType: "computed",
    presence: "required",
    primaryKey: true,
    value: v.string(),
  },
} as const);

const sync = async (url: string) => {
  const response = await fetch(new URL("/sync", url), { method: "POST" });
  if (!response.ok) {
    throw new Error(
      `The router's sync at ${url} failed with ${response.status}: ${await response.text()}`,
    );
  }
};

const announce = (url: string) =>
  console.error(`The router is at ${url}. Set router in factory.config.ts to this URL, so that factory can reach the hub.`);

/**
 * Calls the router's `/sync` when the router's URL or config changes, so
 * each connection's platform (for GitHub, the App's webhook URL and secret)
 * matches the router. Prints the router's URL when it's new.
 */
export const RouterSync = routerSyncSchema.defineOperations({
  create: async (params) => {
    await sync(params.Url);
    announce(params.Url);
    return { SyncId: randomUUID() };
  },
  update: async (_key, patch, params) => {
    await sync(params.Url);
    if (patch.Url !== undefined) announce(params.Url);
  },
  read: async (key) => key,
  delete: async () => {},
});
