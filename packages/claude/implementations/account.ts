import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import {
  type Account as AccountContract,
  isSecret,
  type Secret,
} from "lightbox";
import * as v from "valibot";

const accountConfig = v.object({
  /** e.g. `secret.env("CLAUDE_CODE_OAUTH_TOKEN")`, from `claude setup-token`. */
  auth: v.custom<Secret>(isSecret, "auth must be a secret"),
});
export type AccountConfig = v.InferInput<typeof accountConfig>;

export type AccountOptions = ResourceOpts<AccountConfig, {}>;

/** The credentials Claude Code runs on. The deployer writes them to the vault, and injects them into every container that lists `claude.runtime`, and no other. */
export class Account
  extends ResourceGroup<AccountConfig>
  implements AccountContract
{
  readonly runtime = "claude";
  readonly secrets: Record<string, Secret>;

  constructor(id: string, { config }: AccountOptions) {
    const { auth } = v.parse(accountConfig, config);
    super("claude/Account", id, config);
    this.secrets = { CLAUDE_CODE_OAUTH_TOKEN: auth };
  }
}
