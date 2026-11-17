import { collectResourceGraph } from "@notation/resource";
import type { OutpostConfig } from "../contracts/outpost.ts";

/** Runs an outpost's config with `load`, and returns the outpost config that its resources contribute. */
export const collectOutpost = async (
  load: () => Promise<unknown>,
): Promise<OutpostConfig> => {
  const graph = await collectResourceGraph(async () => {
    await load();
  });
  const store = graph.resources.find(
    (resource) => resource.type === "factory/deployer/OutpostConfig",
  );
  if (!store) throw new Error(".factory/config.ts declares no outpost resources");
  return (await store.getParams()) as OutpostConfig;
};
