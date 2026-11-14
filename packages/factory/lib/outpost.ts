/** The deployer's calls for the outpost of the repo it's deploying. Stubs: the deployer checks the config, builds its containers, and registers its triggers with the router. */

export const putOutpost = async (_config: unknown): Promise<void> => {
  throw new Error(
    "not implemented: check the outpost's config, build its containers and register its triggers",
  );
};

export const readOutpost = async (): Promise<unknown> => {
  throw new Error("not implemented: read the outpost's deployed config");
};

export const deleteOutpost = async (): Promise<void> => {
  throw new Error(
    "not implemented: unroute the outpost and put its containers to sleep",
  );
};
