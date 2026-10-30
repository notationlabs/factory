import type { BaseResource, ResourceGroup } from "@notation/resource";
import type { Secret } from "../lib/secret.ts";

/** A secret to keep in a vault: `name` is its item, `value` where its value comes from. */
export type VaultSecretOptions = { id: string; name: string; value: Secret };

/**
 * The hub's write-only secret store. Only the router and deployer read it.
 * `secret()` adds an item, as a concrete resource the vault owns.
 */
export interface Vault extends ResourceGroup {
  readonly provider: string;
  secret(opts: VaultSecretOptions): BaseResource;
}
