import { ResourceGroup } from "@notation/resource";
import {
  type Account as AccountContract,
  type VaultSecret,
} from "@notation/factory";
import { runtime } from "./runtime.ts";

export type AccountOptions = {
  /**
   * A Cursor API key, as a secret in the hub's vault, such as
   * `vault.secret({ id: "cursor-api-key", value: key.credentials.value })`.
   * Generate one on the Cursor dashboard, under API Keys.
   */
  auth: VaultSecret;
};

/** The credentials Cursor Agent runs on. The deployer binds them, and injects them into every container that lists `cursor.runtime`, and no other. */
export class Account extends ResourceGroup implements AccountContract {
  readonly runtime = runtime;
  readonly secrets: Record<string, VaultSecret>;

  constructor(id: string, { auth }: AccountOptions) {
    super("cursor/Account", id, {});
    this.secrets = { CURSOR_API_KEY: auth };
  }
}
