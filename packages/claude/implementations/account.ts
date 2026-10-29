import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import { type Account as AccountContract, isSecret, type Secret } from "factory";
import * as v from "valibot";

const accountConfig = v.object({
  /** e.g. `secret.env("CLAUDE_CODE_OAUTH_TOKEN")`, from `claude setup-token`. */
  auth: v.custom<Secret>(isSecret, "auth must be a secret"),
});

export type AccountOptions = ResourceOpts<v.InferInput<typeof accountConfig>, {}>;

/** The credentials Claude Code runs on. The deployer writes them to the vault, and injects them into every container that lists `claude.runtime`, and no other. */
export class Account extends ResourceGroup implements AccountContract {
  readonly key: string;
  readonly runtime = "claude";
  readonly secrets: Record<string, Secret>;

  constructor({ id, config }: AccountOptions) {
    const { auth } = v.parse(accountConfig, config);
    super("claude/Account", { key: id });
    this.key = id;
    this.secrets = { CLAUDE_CODE_OAUTH_TOKEN: auth };
  }
}
