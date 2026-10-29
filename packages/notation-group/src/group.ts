import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import type { StandardSchemaV1 } from "./standard-schema.ts";

/*
 * A group is defined the way a concrete resource is, and used the way one
 * is: constructed with `{ id, config, dependencies }`, it has `id`, `config`
 * and `dependencies`. The resources its implementation returns are its
 * fields too, e.g. `router.api`.
 *
 * It holds its Notation ResourceGroup, as `group`, rather than being one:
 * ResourceGroup's own `id`, `config` and `dependencies` are a number, an
 * untyped record and a record of group ids.
 */

export type GroupDependencies = Record<string, Group<any, any>>;

/** What every group has. A contract is an interface that extends it, and adds the resources and methods every implementation has. */
export interface Group<C = {}, D extends GroupDependencies = {}> {
  readonly type: string;
  readonly id: string;
  readonly config: C;
  readonly dependencies: D;
  readonly group: ResourceGroup;
}

/** The class `defineImplementation` returns: a group, with the resources its implementation returned as fields. Extend it to add methods. */
export interface GroupClass<C, D extends GroupDependencies, R> {
  new (opts: ResourceOpts<C, D>): Group<C, D> & R;
  readonly type: string;
}

/** A contract's fields that an implementation returns: those that aren't Group's or methods. */
type ContractResources<Contract> = {
  [K in keyof Contract as K extends keyof Group
    ? never
    : Contract[K] extends (...args: any[]) => any
      ? never
      : K]: Contract[K];
};

type Build<C, D, R> = (opts: {
  id: string;
  config: C;
  deps: D;
  group: ResourceGroup;
}) => R;

type ImplementationBuilder<
  Contract extends Group<any, any>,
  C,
  D extends GroupDependencies,
> = {
  defineImplementation: <
    R extends ContractResources<Contract> & { [K in keyof Group]?: never },
  >(
    build: Build<C, D, R>,
  ) => GroupClass<C, D, R>;
};

type DependenciesBuilder<Contract extends Group<any, any>, C> = ImplementationBuilder<
  Contract,
  C,
  Contract["dependencies"]
> & {
  requireDependencies: <
    D extends Contract["dependencies"],
  >() => ImplementationBuilder<Contract, C, D>;
};

/**
 * Defines a group:
 *
 *   defineGroup<Contract>({ type })
 *     .defineSchema(schema)
 *     .requireDependencies<D>()
 *     .defineImplementation(({ id, config, deps, group }) => resources)
 *
 * `Contract`, if given, is the interface the group implements: its config,
 * dependencies and resources must satisfy it. `defineSchema` takes any
 * Standard Schema, which validates the group's config. `defineImplementation`
 * adds the group's concrete resources to `group`, or contributes to ones that
 * exist, and returns the resources other groups need, which become the
 * group's fields.
 */
export const defineGroup = <
  Contract extends Group<any, any> = Group,
>(meta: {
  type: `${string}/${string}`;
}) => ({
  defineSchema: <C extends Contract["config"]>(
    schema: StandardSchemaV1<unknown, C>,
  ): DependenciesBuilder<Contract, C> => {
    const defineImplementation = <D extends GroupDependencies, R>(
      build: Build<C, D, R>,
    ): GroupClass<C, D, R> =>
      class implements Group<C, D> {
        static readonly type = meta.type;
        readonly type = meta.type;
        readonly id: string;
        readonly config: C;
        readonly dependencies: D;
        readonly group: ResourceGroup;

        constructor(opts: ResourceOpts<C, D>) {
          const { id } = opts;
          const config = validate(schema, meta.type, id, opts.config);
          const deps = (opts.dependencies ?? {}) as D;
          this.id = id;
          this.config = config;
          this.dependencies = deps;
          this.group = new Resources(meta.type, {
            ...config,
            dependencies: Object.fromEntries(
              Object.entries(deps).map(([k, d]) => [k, d.group.id]),
            ),
          });
          Object.assign(this, build({ id, config, deps, group: this.group }));
        }
      } as GroupClass<C, D, R>;
    return {
      defineImplementation,
      requireDependencies: () => ({ defineImplementation }),
    } as DependenciesBuilder<Contract, C>;
  },
});

/** ResourceGroup is abstract. */
class Resources extends ResourceGroup {}

const validate = <C>(
  schema: StandardSchemaV1<unknown, C>,
  type: string,
  id: string,
  config: unknown,
): C => {
  const result = schema["~standard"].validate(config ?? {});
  if (result instanceof Promise)
    throw new Error(`${type}: its schema must validate synchronously`);
  if (result.issues)
    throw new Error(`${id}: ${result.issues.map((i) => i.message).join("; ")}`);
  return result.value;
};
