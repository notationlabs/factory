import { ResourceGroup } from "@notation/resource";
import type { Vault as VaultContract, VaultSecretOptions } from "@notation/factory";
import type { ProjectInstance } from "../resources/project.ts";
import {
  SealedVariable,
  type SealedVariableInstance,
} from "../resources/variable.ts";

/**
 * `new railway.Vault(...)`: sealed shared variables in the hub's project.
 * The project is the router's, so the vault takes secrets once a
 * `railway.Router` has bound it.
 */
export class Vault extends ResourceGroup implements VaultContract {
  readonly provider = "railway";
  #project?: ProjectInstance;

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

  secret({ id, name }: VaultSecretOptions): SealedVariableInstance {
    if (!this.#project) {
      throw new Error(
        `railway.Vault: pass it to a railway.Router before adding ${name}`,
      );
    }
    return this.add(
      new SealedVariable(id, {
        config: { name },
        dependencies: { project: this.#project },
      }),
    );
  }
}
