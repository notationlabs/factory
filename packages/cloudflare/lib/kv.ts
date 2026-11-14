/** The KV value calls the router's config makes. Stubs. */

export type ValueKey = { AccountId: string; NamespaceId: string; Key: string };

export const putValue = async (
  _key: ValueKey,
  _value: unknown,
): Promise<void> => {
  throw new Error("not implemented: write a KV value as JSON");
};

export const getValue = async (_key: ValueKey): Promise<unknown> => {
  throw new Error("not implemented: read a KV value as JSON");
};

export const deleteValue = async (_key: ValueKey): Promise<void> => {
  throw new Error("not implemented: delete a KV value");
};
