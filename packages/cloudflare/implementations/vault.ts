import { ResourceGroup } from "@notation/resource";
import {
  type Vault as VaultContract,
  type VaultSecret,
  type VaultSecretOptions,
} from "@notation/factory";
import { SecretGroup, secret } from "@notation/cloudflare/secrets-store";

/**
 * `new cloudflare.Vault(id)`: the hub's secrets, in the account's Secrets
 * Store. Each secret's name in the store is `<app>--<stage>--<id>`. Values
 * can't be read back through the API.
 */
export class Vault extends ResourceGroup implements VaultContract<SecretGroup> {
  readonly provider = "cloudflare";

  constructor(id: string) {
    super("cloudflare/Vault", id);
  }

  secret({ id, source, key }: VaultSecretOptions): SecretGroup {
    return secret(source ? { id, source, key } : { id });
  }
}

/** Throws unless `secret` came from a `cloudflare.Vault`. */
export function assertCloudflareSecret(
  secret: VaultSecret,
): asserts secret is SecretGroup {
  if (!(secret instanceof SecretGroup)) {
    throw new Error(
      `${secret.id} is not a secret from a cloudflare.Vault, so a Cloudflare Worker can't bind it.`,
    );
  }
}
