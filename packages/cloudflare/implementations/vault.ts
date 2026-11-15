import { declareSecret, PROMPT_SOURCE } from "@notation/core";
import { ResourceGroup, scopedPhysicalName } from "@notation/resource";
import {
  type Vault as VaultContract,
  type VaultSecret,
  type VaultSecretOptions,
} from "@notation/factory";
import { secretsStore } from "@notation/cloudflare/resources";
import {
  type BindableSecret,
  SecretsStoreGroup,
} from "@notation/cloudflare/secrets-store";
import * as std from "@notation/std/resources";
import { deleteSecret, writeSecret } from "../lib/secrets-store.ts";

// Cloudflare's limit on the length of a secret's name.
const SECRET_NAME_MAX_LENGTH = 255;

/**
 * A secret whose value is another resource's credential, such as
 * `token.credentials.Value`. Only deploy writes it, so `notation secret set`
 * refuses it.
 */
export type CredentialSecretOptions = {
  id: string;
  credential: string;
  source?: undefined;
  key?: undefined;
};

export type CloudflareSecretOptions =
  | VaultSecretOptions
  | CredentialSecretOptions;

/**
 * One vault secret: a Secrets Store secret, and a `SourceValue` when the
 * value comes from a source.
 */
export class CloudflareSecret extends ResourceGroup implements BindableSecret {
  platform = "cloudflare";
  /** The secret's name in the store: `<app>--<stage>--<id>`. */
  readonly name: string;
  readonly secret: secretsStore.SecretsStoreSecretInstance;
  /** Records the source and key of a secret that has a source. */
  readonly value?: std.sources.SourceValueInstance;

  constructor(
    opts: CloudflareSecretOptions,
    store: secretsStore.SecretsStoreInstance,
  ) {
    const { id } = opts;
    super("cloudflare/Secret", id, { id });
    this.name = scopedPhysicalName(id, { maxLength: SECRET_NAME_MAX_LENGTH });
    const name = this.name;

    if ("credential" in opts) {
      this.secret = this.add(
        new secretsStore.SecretsStoreSecret(`secret:${id}`, {
          config: { Name: name, StageScoped: true, Value: opts.credential },
          dependencies: { store },
        }),
      );
      declareSecret({
        id,
        refusal: `\`${id}\` holds another resource's credential, and only deploy writes its value.`,
      });
      return;
    }

    const { source, key } = opts;
    if (source) {
      this.value = this.add(
        new std.sources.SourceValue(`value:${id}`, {
          config: { Secret: id, Source: source.name, Key: key },
        }),
      );
    }
    this.secret = this.add(
      new secretsStore.SecretsStoreSecret(`secret:${id}`, {
        config: {
          Name: name,
          StageScoped: true,
          ValueFrom: this.value
            ? {
                Secret: id,
                Source: source!.name,
                Key: key,
                Version: this.value.outputRef("Version"),
              }
            : { Secret: id, Source: PROMPT_SOURCE },
        },
        dependencies: { store },
      }),
    );
    declareSecret({
      id,
      source,
      key,
      set: (value) => writeSecret(name, value),
      delete: () => deleteSecret(name),
    });
  }

  "~secret"() {
    return this.secret;
  }
}

/**
 * `new cloudflare.Vault(id)`: the hub's secrets, in the account's Secrets
 * Store. Each secret's name in the store is `<app>--<stage>--<id>`. Values
 * can't be read back through the API.
 *
 * The vault owns the deployment's `SecretsStoreGroup`, so nothing else in
 * the deployment can call Notation's `secret()` or `accountToken()`: each
 * would create a second group, which throws.
 */
export class Vault
  extends ResourceGroup
  implements VaultContract<CloudflareSecret>
{
  readonly provider = "cloudflare";
  readonly store: SecretsStoreGroup;
  readonly #names = new Map<string, string>();

  constructor(id: string) {
    super("cloudflare/Vault", id);
    this.store = new SecretsStoreGroup();
  }

  secret(opts: CloudflareSecretOptions): CloudflareSecret {
    const name = scopedPhysicalName(opts.id, {
      maxLength: SECRET_NAME_MAX_LENGTH,
    });
    if (name.includes(".")) {
      throw new Error(
        `The secret ${opts.id} would be stored as ${name}, but Cloudflare rejects a secret name with a dot.`,
      );
    }
    const other = this.#names.get(name);
    if (other !== undefined) {
      throw new Error(
        other === opts.id
          ? `The vault already has a secret with the id ${opts.id}.`
          : `Secrets ${other} and ${opts.id} would both be stored as ${name}.`,
      );
    }
    this.#names.set(name, opts.id);
    return new CloudflareSecret(opts, this.store.store);
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
