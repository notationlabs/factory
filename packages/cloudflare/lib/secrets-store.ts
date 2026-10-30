/** The Secrets Store API calls the vault makes. Stubs. Values are written, never read back: a secret is planned by whether it exists. */

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

export const putSecret = async (_key: {
  storeId: string;
  name: string;
}): Promise<void> => {
  throw new Error("not implemented: mint the secret's value into the store");
};

export const getSecret = async (_key: {
  storeId: string;
  name: string;
}): Promise<{}> => {
  throw new Error(
    "not implemented: read the secret's metadata, or throw ResourceNotFoundError",
  );
};

export const deleteSecret = async (_key: {
  storeId: string;
  name: string;
}): Promise<void> => {
  throw new Error("not implemented: delete a secret from the store");
};
