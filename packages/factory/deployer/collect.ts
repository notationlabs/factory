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
  if (!store) throw new Error(".factory/infra.ts declares no outpost resources");
  return (await store.getParams()) as OutpostConfig;
};

/** Runs an outpost's config with `load`, and calls the worktree function of the trigger `id` with `event`. */
export const collectWorktree = async (
  load: () => Promise<unknown>,
  id: string,
  event: unknown,
): Promise<string | undefined> => {
  const graph = await collectResourceGraph(async () => {
    await load();
  });
  const trigger = graph.resourceGroups.find((group) => group.type === "factory/Trigger" && group.id === id);
  if (!trigger) throw new Error(`.factory/infra.ts declares no trigger ${id}`);
  const worktree = trigger.config.worktree as ((event: unknown) => string | undefined) | undefined;
  return worktree?.(event);
};
