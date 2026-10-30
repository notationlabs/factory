import { outputSources, ResourceGroup } from "@notation/resource";
import type { Vault as VaultContract, VaultSecretOptions } from "lightbox";
import * as v from "valibot";
import {
  SecretsStore,
  type SecretsStoreInstance,
  StoreSecret,
  type StoreSecretInstance,
} from "../resources/secrets-store.ts";

const vaultConfig = v.object({ name: v.optional(v.string()) });
export type VaultConfig = v.InferInput<typeof vaultConfig>;

export type VaultOptions = VaultConfig;

/** `new cloudflare.Vault(...)`: a Secrets Store store, bound to the router and deployer Workers. Values can't be read back through the API. */
export class Vault extends ResourceGroup<VaultConfig> implements VaultContract {
  readonly provider = "cloudflare";
  readonly store: SecretsStoreInstance;

  constructor(id: string, config: VaultOptions = {}) {
    const { name = id } = v.parse(vaultConfig, config);
    super("cloudflare/Vault", id, config);
    this.store = this.add(
      new SecretsStore(`${id}-store`, { config: { name } }),
    );
  }

  secret({
    id,
    name,
    value,
    readers,
  }: VaultSecretOptions): StoreSecretInstance {
    const item = this.add(
      new StoreSecret(id, {
        config: { name, source: value },
        dependencies: { store: this.store },
      }),
    );
    // An output value's resource must exist before its value can be written.
    for (const source of outputSources(value)) item.dependOn(source);
    for (const reader of readers) reader.bindSecret(item);
    return item;
  }
}
