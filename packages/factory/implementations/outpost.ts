import {
  collectResourceGraph,
  ResourceGroup,
  type ResourceOpts,
} from "@notation/resource";
import {
  OutpostConfig,
  type OutpostConfigInstance,
} from "../resources/outpost-config.ts";

type OutpostGroupConfig = { repo: string };

/** A repo's outpost. Its channels, containers, policies, agents and triggers contribute to `store`, the one entry the deployer applies. */
export class Outpost extends ResourceGroup<OutpostGroupConfig> {
  readonly repo: string;
  readonly store: OutpostConfigInstance;

  constructor({ id, config }: ResourceOpts<OutpostGroupConfig, {}>) {
    super("factory/Outpost", { id, config });
    this.repo = config.repo;
    this.store = this.add(
      new OutpostConfig({ id: `${id}-config`, config: { repo: config.repo } }),
    );
  }
}

let active: Outpost | undefined;

/**
 * A repo's outpost config: `export default outpost(() => { … })`. The
 * deployer calls the result with the repo it's deploying, which collects the
 * outpost's graph. It's separate from the infra's graph: outposts find the
 * infra's connections by name.
 */
export const outpost = (declare: () => void) => (repo: string) =>
  collectResourceGraph(() => {
    active = new Outpost({ id: "outpost", config: { repo } });
    try {
      declare();
    } finally {
      active = undefined;
    }
  });

/** The outpost being declared. Outpost resources contribute to it, so they can only be made inside `outpost(() => …)`. */
export const currentOutpost = (): Outpost => {
  if (!active)
    throw new Error("Declare outpost resources inside outpost(() => { … })");
  return active;
};
