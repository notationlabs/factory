import { type CredentialRef, ResourceGroup } from "@notation/resource";
import type { RepoPattern } from "../contracts/router.ts";

export type OutpostSecretOptions = {
  /** The env var name that containers read the secret as, such as `DATABASE_URL`. */
  name: string;
  /** A credential, such as `source.credentials.value`. The deployer writes it to the hub's vault. */
  value: CredentialRef<string>;
  /** The repos whose containers get the secret, in the form of the code host's `allow`. */
  allowedRepos: RepoPattern[];
};

/**
 * `new OutpostSecret(id, ...)`: a secret that the containers of
 * `allowedRepos` get as the env var `name`. Pass it to the deployer's
 * `secrets`, which writes it to the hub's vault and binds it.
 */
export class OutpostSecret extends ResourceGroup {
  readonly name: string;
  readonly value: CredentialRef<string>;
  readonly allowedRepos: RepoPattern[];

  constructor(id: string, { name, value, allowedRepos }: OutpostSecretOptions) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`The outpost secret ${id} has the name ${JSON.stringify(name)}, which isn't an env var name.`);
    }
    if (allowedRepos.length === 0) {
      throw new Error(`The outpost secret ${id} has no allowedRepos, so no container would get it.`);
    }
    super("factory/OutpostSecret", id, { name, allowedRepos });
    this.name = name;
    this.value = value;
    this.allowedRepos = allowedRepos;
  }
}
