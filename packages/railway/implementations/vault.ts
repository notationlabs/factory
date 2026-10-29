import {
  outputSources,
  ResourceGroup,
  type ResourceOpts,
} from "@notation/resource";
import type { Vault as VaultContract, VaultSecretOptions } from "factory";
import type { ProjectInstance } from "../resources/project.ts";
import {
  SealedVariable,
  type SealedVariableInstance,
} from "../resources/variable.ts";

export type VaultOptions = ResourceOpts<{}, {}>;

/**
 * `new railway.Vault(...)`: sealed shared variables in the hub's project.
 * The project is the router's, so the vault takes secrets once a
 * `railway.Router` has bound it.
 */
export class Vault extends ResourceGroup implements VaultContract {
  readonly provider = "railway";
  #project?: ProjectInstance;

  constructor({ config }: VaultOptions) {
    super("railway/Vault", { config });
  }

  /** Called by the router that takes this vault. */
  bind(project: ProjectInstance): void {
    if (this.#project)
      throw new Error("railway.Vault is already bound to a router");
    this.#project = project;
  }

  secret({ id, name, value }: VaultSecretOptions): SealedVariableInstance {
    if (!this.#project)
      throw new Error(
        `railway.Vault: pass it to a railway.Router before adding ${name}`,
      );
    const item = this.add(
      new SealedVariable({
        id,
        config: { name, source: value },
        dependencies: { project: this.#project },
      }),
    );
    // An output value's resource must exist before its value can be written.
    for (const source of outputSources(value)) item.dependOn(source);
    return item;
  }
}
