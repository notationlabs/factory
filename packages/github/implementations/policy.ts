import type { ResourceOpts } from "@notation/resource";
import { OutpostGroup, type PolicyContract } from "lightbox";
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
export type PolicyConfig = v.InferInput<typeof policyConfig>;

export type PolicyOptions = ResourceOpts<PolicyConfig, {}>;

/** A 1-hour installation token for `repo` (default: the outpost's repo), with `permissions`, minted by the code host before each run. */
export class Policy
  extends OutpostGroup<PolicyConfig>
  implements PolicyContract
{
  readonly provider = "github";

  constructor({ id, config }: PolicyOptions) {
    super("github/Policy", { id, config });
    const { outpost } = this.dependencies;
    const { repo = outpost.repo, permissions } = v.parse(policyConfig, config);
    outpost.store.contribute(
      { policies: { [id]: { provider: "github", repo, permissions } } },
      { by: `policy ${id}` },
    );
  }
}
