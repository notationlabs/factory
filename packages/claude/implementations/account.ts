import { ResourceGroup } from "@notation/resource";
import {
  type Account as AccountContract,
  type SecretValueFrom,
  secretValueFrom,
} from "@notation/factory";
import * as v from "valibot";

const accountConfig = v.object({
  /**
   * The OAuth token from `claude setup-token`, such as
   * `{ source: env, key: "CLAUDE_CODE_OAUTH_TOKEN" }`. Without a source,
   * deploy asks for it.
   */
  auth: secretValueFrom,
});
export type AccountConfig = v.InferInput<typeof accountConfig>;

export type AccountOptions = AccountConfig;

/** The credentials Claude Code runs on. The deployer declares them in the vault, and injects them into every container that lists `claude.runtime`, and no other. */
export class Account
  extends ResourceGroup<AccountConfig>
  implements AccountContract
{
  readonly runtime = "claude";
  readonly secrets: Record<string, SecretValueFrom>;

  constructor(id: string, config: AccountOptions) {
    const { auth } = v.parse(accountConfig, config);
    super("claude/Account", id, config);
    this.secrets = { CLAUDE_CODE_OAUTH_TOKEN: auth };
  }
}
