import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import type { StandardSchemaV1 } from "./standard-schema.ts";

/*
 * A group is defined the way a concrete resource is, and used the way one
 * is: constructed with `{ id, config, dependencies }`, it has `id`, `config`
 * and `dependencies`. Where a resource has `output`, a group has `parts`: the
 * concrete resources its implementation built, there as soon as it's
 * constructed.
 *
 * It holds its Notation ResourceGroup, as `group`, rather than being one:
 * ResourceGroup's own `id`, `config` and `dependencies` are a number, an
 * untyped record and a record of group ids.
 */

export type GroupDependencies = Record<string, Group<any, any, any>>;

/** A group's instance type. A contract is an interface that extends it, e.g. `Group<{}, {}, { api: RouterApi }>`. */
export interface Group<C = {}, D extends GroupDependencies = {}, P = {}> {
  readonly type: string;
  readonly id: string;
  readonly config: C;
  readonly dependencies: D;
  readonly parts: P;
  readonly group: ResourceGroup;
}

/** The class `defineImplementation` returns. Extend it to add methods. */
export interface GroupClass<C, D extends GroupDependencies, P> {
  new (opts: ResourceOpts<C, D>): Group<C, D, P>;
  readonly type: string;
}

type Build<C, D, P> = (opts: {
  id: string;
  config: C;
  deps: D;
  group: ResourceGroup;
}) => P;

type ImplementationBuilder<Contract extends Group<any, any, any>, C, D extends GroupDependencies> = {
  defineImplementation: <P extends Contract["parts"]>(
    build: Build<C, D, P>,
  ) => GroupClass<C, D, P>;
};

type DependenciesBuilder<Contract extends Group<any, any, any>, C> = ImplementationBuilder<
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
 *     .defineImplementation(({ id, config, deps, group }) => parts)
 *
 * `Contract`, if given, is the interface the group implements: its config,
 * dependencies and parts must satisfy it. `defineSchema` takes any Standard
 * Schema, which validates the group's config. `defineImplementation` adds the
 * group's concrete resources to `group`, or contributes to ones that exist,
 * and returns its parts.
 */
export const defineGroup = <
  Contract extends Group<any, any, any> = Group,
>(meta: {
  type: `${string}/${string}`;
}) => ({
  defineSchema: <C extends Contract["config"]>(
    schema: StandardSchemaV1<unknown, C>,
  ): DependenciesBuilder<Contract, C> => {
    const defineImplementation = <D extends GroupDependencies, P>(
      build: Build<C, D, P>,
    ): GroupClass<C, D, P> =>
      class implements Group<C, D, P> {
        static readonly type = meta.type;
        readonly type = meta.type;
        readonly id: string;
        readonly config: C;
        readonly dependencies: D;
        readonly parts: P;
        readonly group: ResourceGroup;

        constructor(opts: ResourceOpts<C, D>) {
          const { id } = opts;
          const config = validate(schema, meta.type, id, opts.config);
          const deps = (opts.dependencies ?? {}) as D;
          this.id = id;
          this.config = config;
          this.dependencies = deps;
          this.group = new Members(meta.type, {
            ...config,
            dependencies: Object.fromEntries(
              Object.entries(deps).map(([k, d]) => [k, d.group.id]),
            ),
          });
          this.parts = build({ id, config, deps, group: this.group });
        }
      };
    return {
      defineImplementation,
      requireDependencies: () => ({ defineImplementation }),
    } as DependenciesBuilder<Contract, C>;
  },
});

/** ResourceGroup is abstract. */
class Members extends ResourceGroup {}

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
