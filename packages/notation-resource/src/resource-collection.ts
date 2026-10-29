import type { BaseResource } from "./resource";
import type { ResourceGroup } from "./resource-group";

export type ResourceGraph = {
  resourceGroups: ResourceGroup[];
  resources: BaseResource[];
};

type ResourceCollection = {
  graph: ResourceGraph;
  nextResourceGroupId: number;
  /** Set once evaluation finishes: contributions close then. */
  closed: boolean;
};

let activeCollection: ResourceCollection | undefined;

export async function collectResourceGraph(
  evaluate: () => unknown | Promise<unknown>,
): Promise<ResourceGraph> {
  if (activeCollection) {
    throw new Error("A resource graph is already being collected.");
  }

  const collection: ResourceCollection = {
    graph: { resourceGroups: [], resources: [] },
    nextResourceGroupId: 0,
    closed: false,
  };

  activeCollection = collection;
  try {
    await evaluate();
    return collection.graph;
  } finally {
    collection.closed = true;
    activeCollection = undefined;
  }
}

export function getActiveResourceCollection(): ResourceCollection | undefined {
  return activeCollection;
}
