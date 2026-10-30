import { defineResource } from "@notation/resource";
import type { Secret } from "factory";
import {
  createStore,
  deleteSecret,
  getSecret,
  getStore,
  putSecret,
} from "../lib/secrets-store.ts";

type SecretsStoreApi = {
  Key: { id: string };
  CreateParams: { name: string };
  UpdateParams: undefined;
  ReadResult: { id: string; name: string };
};

/** The vault's store. Protected, like a GitHub App: a hub re-created in the same account finds its keys. */
export const SecretsStore = defineResource<SecretsStoreApi>({
  type: "cloudflare/secrets-store/Store",
})
  .defineSchema({
    name: { propertyType: "param", presence: "required", immutable: true },
    id: { propertyType: "computed", presence: "required", primaryKey: true },
  } as const)
  .defineOperations({
    create: async (params) => createStore(params),
    read: async (key) => getStore(key),
    delete: async () => {
      throw new Error(
        "The vault is protected: delete its Secrets Store store in the dashboard",
      );
    },
  });

export type SecretsStoreInstance = InstanceType<typeof SecretsStore>;

type StoreSecretApi = {
  Key: { storeId: string; name: string };
  CreateParams: { storeId: string; name: string; source: Secret };
  UpdateParams: undefined;
  ReadResult: { fingerprint: string };
};

/** One item in the vault. `source` says where its value comes from; it's planned by `fingerprint`, never by reading the value. */
export const StoreSecret = defineResource<StoreSecretApi>({
  type: "cloudflare/secrets-store/Secret",
})
  .defineSchema({
    storeId: {
      propertyType: "param",
      presence: "required",
      secondaryKey: true,
    },
    name: { propertyType: "param", presence: "required", primaryKey: true },
    source: { propertyType: "param", presence: "required" },
    fingerprint: { propertyType: "computed", presence: "required" },
  } as const)
  .defineOperations({
    create: async ({ storeId, name, source }) =>
      putSecret({ storeId, name }, source),
    read: async (key) => getSecret(key),
    update: async (key, _patch, { source }) => putSecret(key, source),
    delete: async (key) => deleteSecret(key),
  })
  .requireDependencies<{ store: SecretsStoreInstance }>()
  .deriveParams(({ deps }) => ({ storeId: deps.store.output.id }));

export type StoreSecretInstance = InstanceType<typeof StoreSecret>;
