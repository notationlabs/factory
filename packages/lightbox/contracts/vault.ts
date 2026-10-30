import type { BaseResource, ResourceGroup } from "@notation/resource";
import type { Secret } from "../lib/secret.ts";

/** One item in a vault. Its `name` is what its readers bind it as. */
export type VaultItem = BaseResource & { readonly config: { name: string } };

/** A process that reads vault items, e.g. the router. Binding an item makes the process depend on it. */
export interface SecretReader {
  bindSecret(item: VaultItem): void;
}

/** A secret to keep in a vault: `name` is its item, `value` where its value comes from, `readers` the processes bound to it. */
export type VaultSecretOptions = {
  id: string;
  name: string;
  value: Secret;
  readers: SecretReader[];
};

/**
 * The hub's write-only secret store. Only the processes an item names as
 * readers bind it. `secret()` adds an item, as a concrete resource the vault
 * owns, and binds it to each reader.
 */
export interface Vault extends ResourceGroup {
  readonly provider: string;
  secret(opts: VaultSecretOptions): VaultItem;
}
