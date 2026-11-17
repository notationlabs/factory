import { ResourceGroup } from "@notation/resource";
import {
  type Account as AccountContract,
  type VaultSecret,
} from "@notation/factory";
import { runtime } from "./runtime.ts";

export type AccountOptions = {
  /**
   * The OAuth token from `claude setup-token`, as a secret in the hub's
   * vault, such as
   * `vault.secret({ id: "claude-oauth-token", value: token.credentials.value })`.
   */
  auth: VaultSecret;
};

/** The credentials Claude Code runs on. The deployer binds them, and injects them into every container that lists `claude.runtime`, and no other. */
export class Account extends ResourceGroup implements AccountContract {
  readonly runtime = runtime;
  readonly secrets: Record<string, VaultSecret>;

  constructor(id: string, { auth }: AccountOptions) {
    super("claude/Account", id, {});
    this.secrets = { CLAUDE_CODE_OAUTH_TOKEN: auth };
  }
}
