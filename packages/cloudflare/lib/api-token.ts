/** The API token calls the deployer makes. Stubs. */

export const createToken = async (_params: {
  name: string;
  permissions: string[];
}): Promise<{ id: string; value: string }> => {
  throw new Error("not implemented: create an account API token");
};

export const getToken = async (_key: {
  id: string;
}): Promise<{ id: string; value: string }> => {
  throw new Error("not implemented: read an account API token");
};

export const deleteToken = async (_key: { id: string }): Promise<void> => {
  throw new Error("not implemented: delete an account API token");
};
