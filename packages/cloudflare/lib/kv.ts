/** The KV API calls the hub's resources make. Stubs: achq's plugin-cloudflare has the real ones. */

export const createNamespace = async (_params: {
  title: string;
}): Promise<{ id: string }> => {
  throw new Error("not implemented: create a KV namespace");
};

export const getNamespace = async (_key: {
  id: string;
}): Promise<{ id: string; title: string }> => {
  throw new Error("not implemented: read a KV namespace");
};

export const deleteNamespace = async (_key: { id: string }): Promise<void> => {
  throw new Error("not implemented: delete a KV namespace");
};

export const putValue = async (
  _key: { namespaceId: string; key: string },
  _value: unknown,
): Promise<void> => {
  throw new Error("not implemented: write a KV value as JSON");
};

export const getValue = async (_key: {
  namespaceId: string;
  key: string;
}): Promise<unknown> => {
  throw new Error("not implemented: read a KV value as JSON");
};

export const deleteValue = async (_key: {
  namespaceId: string;
  key: string;
}): Promise<void> => {
  throw new Error("not implemented: delete a KV value");
};
