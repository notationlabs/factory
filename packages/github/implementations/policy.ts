import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import { currentOutpost, type PolicyContract } from "factory";
import * as v from "valibot";

const level = v.optional(v.picklist(["read", "write"]));

const policyConfig = v.object({
  repo: v.optional(v.string()),
  permissions: v.object({
    actions: level,
    actions_variables: level,
    checks: level,
    contents: level,
    issues: level,
    metadata: level,
    pull_requests: level,
    statuses: level,
    workflows: level,
  }),
});

export type PolicyOptions = ResourceOpts<v.InferInput<typeof policyConfig>, {}>;

/** A 1-hour installation token for `repo` (default: the outpost's repo), with `permissions`, minted by the code host before each run. */
export class Policy extends ResourceGroup implements PolicyContract {
  readonly key: string;
  readonly provider = "github";

  constructor({ id, config }: PolicyOptions) {
    const outpost = currentOutpost();
    const { repo = outpost.repo, permissions } = v.parse(policyConfig, config);
    super("github/Policy", { config });
    this.key = id;
    outpost.store.contribute(
      { policies: { [id]: { provider: "github", repo, permissions } } },
      { by: `policy ${id}` },
    );
  }
}
