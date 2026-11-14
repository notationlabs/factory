import { declareSecret, PROMPT_SOURCE } from "@notation/core";
import { ResourceGroup, scopedPhysicalName } from "@notation/resource";
import {
  type SecretConsumer,
  type Vault as VaultContract,
  type VaultSecret,
  type VaultSecretOptions,
  VaultSecrets,
} from "@notation/factory";
import * as std from "@notation/std/resources";
import {
  deleteSealedVariable,
  findProject,
  putSealedVariable,
  type SealedVariableKey,
} from "../lib/railway.ts";
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
  scopedPhysicalName(id, { maxLength: VARIABLE_NAME_MAX_LENGTH }).replace(
    /[^A-Za-z0-9_]/g,
    "_",
  );

type ProjectRef = { resource: ProjectInstance; name: string };

/**
 * One vault secret: a sealed shared variable, and a `SourceValue` when the
 * value comes from a source.
 */
export class RailwaySecret extends ResourceGroup implements VaultSecret {
  readonly binding: string;
  readonly consumers: readonly SecretConsumer[];
  /** The sealed variable's name in the project's environment. */
  readonly name: string;
  readonly variable: SealedVariableInstance;
  /** Records the source and key of a secret that has a source. */
  readonly value?: std.sources.SourceValueInstance;

  constructor(opts: VaultSecretOptions, project: ProjectRef) {
    const { id, binding, consumers, source, key } = opts;
    super("railway/Secret", id, { id, binding, consumers });
    this.binding = binding;
    this.consumers = [...consumers];
    this.name = variableName(id);
    const name = this.name;

    if (source) {
      this.value = this.add(
        new std.sources.SourceValue(`value:${id}`, {
          config: { Secret: id, Source: source.name, Key: key! },
        }),
      );
    }
    this.variable = this.add(
      new SealedVariable(`variable:${id}`, {
        config: {
          name,
          valueFrom: this.value
            ? {
                Secret: id,
                Source: source!.name,
                Key: key!,
                Version: this.value.outputRef("Version"),
              }
            : { Secret: id, Source: PROMPT_SOURCE },
        },
        dependencies: { project: project.resource },
      }),
    );

    // `notation secret set` and `delete` run outside a deploy, so they find
    // the project by its name rather than from the Project's output.
    const findKey = async (): Promise<SealedVariableKey> => {
      const found = await findProject({ name: project.name });
      if (!found) {
        throw new Error(`No Railway project has the name ${project.name}.`);
      }
      return { projectId: found.id, environmentId: found.environmentId, name };
    };
    declareSecret({
      id,
      source,
      key,
      set: async (value) => putSealedVariable(await findKey(), value),
      delete: async () => deleteSealedVariable(await findKey()),
    });
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
  #project?: ProjectRef;
  readonly #secrets = new VaultSecrets<RailwaySecret>();
  readonly #names = new Map<string, string>();

  constructor(id: string) {
    super("railway/Vault", id);
  }

  /**
   * Called by the router that takes this vault.
   * @param name The project's name, which `notation secret set` looks it up by.
   */
  bind(project: ProjectInstance, name: string): void {
    if (this.#project) {
      throw new Error("railway.Vault is already bound to a router");
    }
    this.#project = { resource: project, name };
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
    const secret = this.#secrets.add(new RailwaySecret(opts, this.#project));
    this.#names.set(name, opts.id);
    return secret;
  }

  bindings(consumer: SecretConsumer): RailwaySecret[] {
    return this.#secrets.for(consumer);
  }
}
