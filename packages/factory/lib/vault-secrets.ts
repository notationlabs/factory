import type { SecretConsumer, VaultSecret } from "../contracts/vault.ts";

/**
 * The bookkeeping a vault needs for `bindings`. It rejects a second secret
 * with the same id, and two secrets that one consumer binds under the same
 * name.
 */
export class VaultSecrets<S extends VaultSecret> {
  readonly #all: S[] = [];

  add(secret: S): S {
    if (secret.consumers.length === 0) {
      throw new Error(`Secret ${secret.id} has no consumers.`);
    }
    for (const other of this.#all) {
      if (other.id === secret.id) {
        throw new Error(
          `The vault already has a secret with the id ${secret.id}.`,
        );
      }
      const shared = secret.consumers.find((c) =>
        other.consumers.includes(c),
      );
      if (shared && other.binding === secret.binding) {
        throw new Error(
          `Secrets ${other.id} and ${secret.id} are both bound to the ${shared} as ${secret.binding}.`,
        );
      }
    }
    this.#all.push(secret);
    return secret;
  }

  for(consumer: SecretConsumer): S[] {
    return this.#all.filter((s) => s.consumers.includes(consumer));
  }
}
