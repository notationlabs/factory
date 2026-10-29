/** The deployer's calls for an outpost. Stubs: the deployer checks the config, builds its containers, and registers its triggers with the router. */

export const putOutpost = async (
  _key: { repo: string },
  _config: unknown,
): Promise<void> => {
  throw new Error(
    "not implemented: check the outpost's config, build its containers and register its triggers",
  );
};

export const readOutpost = async (_key: { repo: string }): Promise<unknown> => {
  throw new Error("not implemented: read the outpost's deployed config");
};

export const deleteOutpost = async (_key: { repo: string }): Promise<void> => {
  throw new Error(
    "not implemented: unroute the outpost and put its containers to sleep",
  );
};
