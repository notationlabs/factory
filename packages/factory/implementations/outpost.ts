import { getActiveResourceCollection, ResourceGroup } from "@notation/resource";
import {
  OutpostConfig,
  type OutpostConfigInstance,
} from "../resources/outpost-config.ts";

/** A repo's outpost. Its channels, containers, policies, agents and triggers contribute to `store`, the one entry the deployer applies. */
export class Outpost extends ResourceGroup {
  readonly store: OutpostConfigInstance;

  constructor(id: string) {
    super("factory/Outpost", id, {});
    this.store = this.add(new OutpostConfig(`${id}-config`, { config: {} }));
  }
}

// One outpost for each collection, so a process can collect more than one
// outpost's graph.
const outposts = new WeakMap<object, Outpost>();

/** The outpost of the graph being collected. The first outpost resource declared makes it. */
const currentOutpost = (): Outpost => {
  const collection = getActiveResourceCollection();
  if (!collection) {
    throw new Error(
      "Declare outpost resources in .factory/config.ts, which the deployer evaluates with Notation",
    );
  }
  let outpost = outposts.get(collection);
  if (!outpost) {
    outpost = new Outpost("outpost");
    outposts.set(collection, outpost);
  }
  return outpost;
};

/**
 * A group declared in an outpost's config. It contributes to that outpost,
 * without the user passing it.
 */
export abstract class OutpostGroup<
  C extends Record<string, any> = Record<string, any>,
> extends ResourceGroup<C> {
  readonly outpost: Outpost;

  constructor(type: string, id: string, config?: C) {
    super(type, id, config);
    this.outpost = currentOutpost();
  }
}
