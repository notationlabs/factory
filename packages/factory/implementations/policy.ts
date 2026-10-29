import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import * as v from "valibot";
import type { PolicyContract } from "../contracts/outpost.ts";
import { currentOutpost } from "./outpost.ts";

const policyConfig = v.object({
  provider: v.string(),
  scopes: v.optional(v.array(v.string()), []),
});

export type PolicyOptions = ResourceOpts<v.InferInput<typeof policyConfig>, {}>;

/** A policy for credentials a plugin's `provider` mints. A code host's own policy (e.g. `github.Policy`) is typed by its provider. */
export class Policy extends ResourceGroup implements PolicyContract {
  readonly key: string;
  readonly provider: string;

  constructor({ id, config }: PolicyOptions) {
    const { provider, scopes } = v.parse(policyConfig, config);
    super("factory/Policy", { key: id, provider, scopes });
    this.key = id;
    this.provider = provider;
    currentOutpost().store.contribute(
      { policies: { [id]: { provider, scopes } } },
      { by: `policy ${id}` },
    );
  }
}
