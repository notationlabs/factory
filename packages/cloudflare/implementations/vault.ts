import { ResourceGroup } from "@notation/resource";
import {
  type Vault as VaultContract,
  type VaultSecret,
  type VaultSecretOptions,
} from "@notation/factory";
import { secretsStore } from "@notation/cloudflare/resources";

/** One vault secret, as a Secrets Store secret that holds a credential. */
export class CloudflareSecret extends ResourceGroup {
  platform = "cloudflare";
  readonly secret: secretsStore.SecretsStoreSecretInstance;

  constructor(
    { id, value }: VaultSecretOptions,
    store: secretsStore.SecretsStoreInstance,
  ) {
    super("cloudflare/Secret", id, { id });
    this.secret = this.add(
      new secretsStore.SecretsStoreSecret(`secret:${id}`, {
        config: { Value: value },
        dependencies: { store },
      }),
    );
  }
}

/**
 * `new cloudflare.Vault(id)`: the hub's secrets, in the account's Secrets
 * Store. Notation names each secret `<app>--<stage>--secret-<id>-<instance>`.
 * Values can't be read back through the API.
 */
export class Vault
  extends ResourceGroup
  implements VaultContract<CloudflareSecret>
{
  readonly provider = "cloudflare";
  readonly store: secretsStore.SecretsStoreInstance;

  constructor(id: string) {
    super("cloudflare/Vault", id);
    this.store = this.add(new secretsStore.SecretsStore(`${id}-store`));
  }

  secret(opts: VaultSecretOptions): CloudflareSecret {
    return new CloudflareSecret(opts, this.store);
  }
}

/** Throws unless `secret` came from a `cloudflare.Vault`. */
export function assertCloudflareSecret(
  secret: VaultSecret,
): asserts secret is CloudflareSecret {
  if (!(secret instanceof CloudflareSecret)) {
    throw new Error(
      `${secret.id} is not a secret from a cloudflare.Vault, so a Cloudflare Worker can't bind it.`,
    );
  }
}
