import { ResourceGroup } from "@notation/resource";
import {
  type Account as AccountContract,
  type VaultSecret,
} from "@notation/factory";
import { runtime } from "./runtime.ts";

export type AccountOptions = {
  /**
   * A Factory API key, as a secret in the hub's vault, such as
   * `vault.secret({ id: "factory-api-key", value: key.credentials.value })`.
   * Generate one on the Factory settings page.
   */
  auth: VaultSecret;
};

/** The credentials Droid runs on. The deployer binds them, and injects them into every container that lists `droid.runtime`, and no other. */
export class Account extends ResourceGroup implements AccountContract {
  readonly runtime = runtime;
  readonly secrets: Record<string, VaultSecret>;

  constructor(id: string, { auth }: AccountOptions) {
    super("droid/Account", id, {});
    this.secrets = { FACTORY_API_KEY: auth };
  }
}
