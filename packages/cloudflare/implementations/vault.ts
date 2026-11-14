import { ResourceGroup } from "@notation/resource";
import {
  type SecretConsumer,
  type Vault as VaultContract,
  type VaultSecret as VaultSecretContract,
  type VaultSecretOptions,
  VaultSecrets,
} from "@notation/factory";
import { type SecretGroup, secret } from "@notation/cloudflare/secrets-store";

/** A secret in the Cloudflare vault: the Secrets Store secret that Workers bind. */
export type VaultSecret = VaultSecretContract & { readonly secret: SecretGroup };

/**
 * `new cloudflare.Vault(id)`: the hub's secrets, in the account's Secrets
 * Store. Each secret's name in the store is `<app>--<stage>--<id>`. Values
 * can't be read back through the API.
 */
export class Vault extends ResourceGroup implements VaultContract<VaultSecret> {
  readonly provider = "cloudflare";
  readonly #secrets = new VaultSecrets<VaultSecret>();

  constructor(id: string) {
    super("cloudflare/Vault", id);
  }

  secret({ id, binding, consumers, ...from }: VaultSecretOptions): VaultSecret {
    return this.#secrets.add({
      id,
      binding,
      consumers: [...consumers],
      secret: secret(
        from.source ? { id, source: from.source, key: from.key } : { id },
      ),
    });
  }

  bindings(consumer: SecretConsumer): VaultSecret[] {
    return this.#secrets.for(consumer);
  }
}
