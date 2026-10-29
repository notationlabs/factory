import type { Secret } from "lightbox";

/** The Secrets Store API calls the vault makes. Stubs. Values are written, never read back: a secret is planned by its fingerprint. */

export const createStore = async (_params: {
  name: string;
}): Promise<{ id: string }> => {
  throw new Error("not implemented: create a Secrets Store store");
};

export const getStore = async (_key: {
  id: string;
}): Promise<{ id: string; name: string }> => {
  throw new Error("not implemented: read a Secrets Store store");
};

export const putSecret = async (
  _key: { storeId: string; name: string },
  _source: Secret,
): Promise<void> => {
  throw new Error(
    "not implemented: resolve the secret's value from its source and write it to the store",
  );
};

export const getSecret = async (_key: {
  storeId: string;
  name: string;
}): Promise<{ fingerprint: string }> => {
  throw new Error("not implemented: read the secret's metadata and fingerprint");
};

export const deleteSecret = async (_key: {
  storeId: string;
  name: string;
}): Promise<void> => {
  throw new Error("not implemented: delete a secret from the store");
};
