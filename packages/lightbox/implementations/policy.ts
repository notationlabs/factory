import type { ResourceOpts } from "@notation/resource";
import * as v from "valibot";
import type { PolicyContract } from "../contracts/outpost.ts";
import { OutpostGroup } from "./outpost.ts";

const policyConfig = v.object({
  provider: v.string(),
  scopes: v.optional(v.array(v.string()), []),
});
export type PolicyConfig = v.InferInput<typeof policyConfig>;

export type PolicyOptions = ResourceOpts<PolicyConfig, {}>;

/** A policy for credentials a plugin's `provider` mints. A code host's own policy (e.g. `github.Policy`) is typed by its provider. */
export class Policy
  extends OutpostGroup<PolicyConfig>
  implements PolicyContract
{
  readonly provider: string;

  constructor({ id, config }: PolicyOptions) {
    const { provider, scopes } = v.parse(policyConfig, config);
    super("lightbox/Policy", { id, config });
    this.provider = provider;
    this.dependencies.outpost.store.contribute(
      { policies: { [id]: { provider, scopes } } },
      { by: `policy ${id}` },
    );
  }
}
