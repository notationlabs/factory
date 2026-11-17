import { ResourceGroup } from "@notation/resource";
import {
  scopedName,
  type Vault as VaultContract,
  type VaultSecret,
  type VaultSecretOptions,
} from "@notation/factory";
import type { ProjectInstance } from "../resources/project.ts";
import {
  SealedVariable,
  type SealedVariableInstance,
} from "../resources/variable.ts";

const VARIABLE_NAME_MAX_LENGTH = 128;

/**
 * Makes the name of a secret's sealed variable: `<app>__<stage>__<id>`,
 * with each character other than a letter, a digit or `_` replaced by `_`.
 * Railway services read variables as env vars, so the name keeps to the
 * characters that env var names allow.
 */
const variableName = (id: string): string =>
  scopedName(id, VARIABLE_NAME_MAX_LENGTH).replace(/[^A-Za-z0-9_]/g, "_");

/** One vault secret, as a sealed shared variable that holds a credential. */
export class RailwaySecret extends ResourceGroup {
  /** The sealed variable's name in the project's environment. */
  readonly name: string;
  readonly variable: SealedVariableInstance;

  constructor({ id, value }: VaultSecretOptions, project: ProjectInstance) {
    super("railway/Secret", id, { id });
    this.name = variableName(id);
    this.variable = this.add(
      new SealedVariable(`variable:${id}`, {
        config: { name: this.name, value },
        dependencies: { project },
      }),
    );
  }

  /** The Railway reference that a service's variable uses to read the secret. */
  get reference(): string {
    return `\${{shared.${this.name}}}`;
  }
}

/**
 * `new railway.Vault(...)`: sealed shared variables in the hub's project.
 * The project is the router's, so the vault takes secrets once a
 * `railway.Router` has bound it.
 */
export class Vault extends ResourceGroup implements VaultContract<RailwaySecret> {
  readonly provider = "railway";
  #project?: ProjectInstance;
  readonly #names = new Map<string, string>();

  constructor(id: string) {
    super("railway/Vault", id);
  }

  /** Called by the router that takes this vault. */
  bind(project: ProjectInstance): void {
    if (this.#project) {
      throw new Error("railway.Vault is already bound to a router");
    }
    this.#project = project;
  }

  secret(opts: VaultSecretOptions): RailwaySecret {
    if (!this.#project) {
      throw new Error(
        `railway.Vault: pass it to a railway.Router before adding ${opts.id}`,
      );
    }
    // Two ids can map to one variable name, such as `a-b` and `a_b`.
    const name = variableName(opts.id);
    const other = this.#names.get(name);
    if (other !== undefined && other !== opts.id) {
      throw new Error(
        `Secrets ${other} and ${opts.id} would both be stored as ${name}.`,
      );
    }
    if (other !== undefined) {
      throw new Error(`The vault already has a secret with the id ${opts.id}.`);
    }
    this.#names.set(name, opts.id);
    return new RailwaySecret(opts, this.#project);
  }
}

/** Throws unless `secret` came from a `railway.Vault`. */
export function assertRailwaySecret(
  secret: VaultSecret,
): asserts secret is RailwaySecret {
  if (!(secret instanceof RailwaySecret)) {
    throw new Error(
      `${secret.id} is not a secret from a railway.Vault, so a Railway service can't bind it.`,
    );
  }
}
