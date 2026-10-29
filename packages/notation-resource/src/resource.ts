import type {
  Schema,
  SchemaItem,
  SchemaFromApi,
  ResolvedSchema,
  ResolveSchema,
  DefineResourceApiSchema,
  Params,
  Result,
  Output,
  State,
  ComputedPrimaryKey,
  CompoundKey,
  Collected,
} from "./resource.schema";
import type {
  OptionalIfAllPropertiesOptional,
  Fallback,
  NoInfer,
} from "./types";
import type { ResourceOperationContext } from "./resource-operation";
import { toComparableParams } from "./diff-params";
import {
  callSite,
  type Contribution,
  LateContributionError,
  ordered,
  outputSources,
  outputValues,
  type OutputValues,
  resolveOutputValues,
  type WithOutputValues,
} from "./contributions";
import { getActiveResourceCollection } from "./resource-collection";

export type { Schema, SchemaItem, DefineResourceApiSchema };

export type ResourceType = `${string}/${string}/${string}`;

export type ResourceOpts<C, D> = OptionalIfAllPropertiesOptional<"config", C> &
  OptionalIfAllPropertiesOptional<"dependencies", D> & { id: string };

/**
 * The object types a resource's schema gives rise to.
 *
 * These are derived from the schema exactly once, when `defineSchema` is
 * called (see {@link InferResourceTypes}). Everything downstream — operation
 * callbacks, instances, dependency inference — is generic over this small
 * bag of plain object types, so the schema literal never re-enters type
 * inference.
 */
export type ResourceTypes = {
  collected: any;
  params: any;
  compoundKey: any;
  primaryKey: any;
  result: any;
  state: any;
  output: any;
};

export type InferResourceTypes<S extends ResolvedSchema> = {
  collected: Collected<S>;
  params: Params<S>;
  compoundKey: CompoundKey<S>;
  primaryKey: ComputedPrimaryKey<S>;
  result: Result<S>;
  state: State<S>;
  output: Output<S>;
};

export interface BaseResource {
  readonly type: ResourceType;
  readonly schema: Schema;
  readonly config: any;
  id: string;
  groupId: number;
  groupType: string;
  readonly output: {};
  readonly dependencies: Record<string, BaseResource | void>;
  readonly key: {};
  /** What's been contributed to its collected params, in call order. */
  readonly contributions: readonly Contribution[];
  contribute(values: Record<string, unknown>, options?: { by?: string }): void;
  dependOn(other: BaseResource): void;
  create: (
    params: any,
    context?: ResourceOperationContext,
  ) => Promise<{} | void>;
  read?: (
    key: any,
    context?: ResourceOperationContext,
  ) => Promise<Record<string, any>>;
  update?: (
    key: any,
    patch: any,
    params: any,
    state: any,
    context?: ResourceOperationContext,
  ) => Promise<void>;
  delete: (
    key: any,
    state: any,
    context?: ResourceOperationContext,
  ) => Promise<void>;
  getParams(): Promise<{}>;
  toState(output: {}): {};
  toComparable(output: {}): {};
  setOutput(result: {}): void;
  deriveParams?: (opts: {
    id: string;
    config: any;
    deps: any;
  }) => Record<string, any> | Promise<Record<string, any>>;
}

export abstract class Resource<
  T extends ResourceTypes = ResourceTypes,
  D extends Record<string, BaseResource | void> = {},
  C extends Record<string, any> = T["params"],
> implements BaseResource {
  config: C;
  id: string;
  groupId = -1;
  groupType = "";
  output = null as any as T["output"];
  dependencies = {} as NoInfer<D>;
  abstract type: ResourceType;
  abstract schema: Schema;
  abstract create: (
    params: T["params"],
    context?: ResourceOperationContext,
  ) => Promise<T["primaryKey"]>;
  abstract read?: (
    key: T["compoundKey"],
    context?: ResourceOperationContext,
  ) => Promise<T["result"]>;
  abstract update?: (
    key: T["compoundKey"],
    patch: T["params"],
    params: T["params"],
    state: T["state"],
    context?: ResourceOperationContext,
  ) => Promise<void>;
  abstract delete: (
    key: T["compoundKey"],
    state: T["state"],
    context?: ResourceOperationContext,
  ) => Promise<void>;
  abstract deriveParams(opts: {
    id: string;
    config: C;
    deps: D;
  }): Record<string, any> | Promise<Record<string, any>>;

  contributions: Contribution[] = [];
  #collection = getActiveResourceCollection();

  /** Its outputs as output values, usable before they exist: `queue.out.QueueUrl`. */
  get out(): OutputValues<T["output"]> {
    return outputValues<T["output"]>(this);
  }

  /**
   * Adds to its collected params. The engine combines contributions with each
   * param's `collect`, in a stable order, at deploy. Any output value in them
   * makes this resource depend on the resource it came from. `by` names the
   * contributor in conflicts, for library code that contributes on the user's
   * behalf; the call site is always recorded.
   */
  contribute(
    values: Partial<WithOutputValues<T["collected"]>>,
    options: { by?: string } = {},
  ): void {
    const at = callSite();
    if (this.#collection?.closed) throw new LateContributionError(this.id, at);
    for (const key of Object.keys(values)) {
      if (!(this.schema as Record<string, { collect?: unknown }>)[key]?.collect)
        throw new Error(`${this.id}: "${key}" doesn't take contributions`);
    }
    for (const source of outputSources(values)) this.dependOn(source);
    this.contributions.push({
      values: values as Record<string, unknown>,
      source: { by: options.by ?? "", at },
    });
  }

  /** Adds a dependency after construction, for ordering only. Same lifetime as `contribute`. */
  dependOn(other: BaseResource): void {
    if (other === (this as BaseResource)) return;
    if (this.#collection?.closed)
      throw new LateContributionError(this.id, callSite());
    (this.dependencies as Record<string, BaseResource>)[`dependOn:${other.id}`] =
      other;
  }

  constructor(opts: ResourceOpts<C, D>) {
    this.id = opts.id;
    this.config = opts.config || ({} as C);
    // A copy: `dependOn` adds to it.
    this.dependencies = { ...opts.dependencies } as D;
    return this;
  }

  get key(): T["compoundKey"] {
    const key = {} as Record<string, any>;
    for (const [k, v] of Object.entries<
      SchemaItem<any> & { primaryKey?: true; secondaryKey?: true }
    >(this.schema)) {
      if (v.primaryKey || v.secondaryKey) {
        key[k] = (this.output as any)[k];
      }
    }
    return key;
  }

  setOutput(output: T["output"]) {
    this.output = output;
  }

  toComparable(output: T["output"]): T["output"] {
    return toComparableParams(this.schema, output as Record<string, unknown>);
  }

  toState(output: T["output"]): T["state"] {
    const parsed = {} as Record<string, any>;
    for (const [k, v] of Object.entries(this.schema)) {
      if (v.hidden) continue;
      if (k in (output as any)) {
        parsed[k] = (output as any)[k];
      }
    }
    return parsed;
  }

  /**
   * Its params: config, then derived params, then each collected param
   * combined from config's value (if any) and every contribution. Output
   * values are filled in from their resources' outputs, or are
   * UNKNOWN_AFTER_APPLY where those aren't known yet.
   */
  async getParams(): Promise<T["params"]> {
    const params: Record<string, unknown> = {
      ...this.config,
      ...(await this.deriveParams({
        id: this.id,
        config: this.config,
        deps: this.dependencies,
      })),
    };
    const contributions = ordered(this.contributions);
    for (const [key, item] of Object.entries(this.schema)) {
      const collect = (item as { collect?: (items: unknown[], from: unknown[]) => unknown }).collect;
      if (!collect) continue;
      const given = contributions.filter((c) => key in c.values);
      if (params[key] === undefined && given.length === 0) continue;
      const fromConfig = params[key] === undefined ? [] : [{ value: params[key], source: { by: "config", at: this.id } }];
      const all = [...fromConfig, ...given.map((c) => ({ value: c.values[key], source: c.source }))];
      params[key] = collect(
        all.map((a) => a.value),
        all.map((a) => a.source),
      );
    }
    return resolveOutputValues(params) as T["params"];
  }
}

export type DefineResourceMeta = { type: ResourceType };

export type ResourceOperationsOptions<
  T extends ResourceTypes,
  IntrinsicParams extends Partial<T["params"]>,
> = {
  create: (
    params: T["params"],
    context?: ResourceOperationContext,
  ) => Promise<T["primaryKey"]>;
  read?: (
    key: T["compoundKey"],
    context?: ResourceOperationContext,
  ) => Promise<T["result"]>;
  update?: (
    key: T["compoundKey"],
    patch: T["params"],
    params: T["params"],
    state: T["state"],
    context?: ResourceOperationContext,
  ) => Promise<void>;
  delete: (
    key: T["compoundKey"],
    state: T["state"],
    context?: ResourceOperationContext,
  ) => Promise<void>;
  deriveParams?: (opts: {
    config: Partial<T["params"]>;
  }) => IntrinsicParams | Promise<IntrinsicParams>;
};

export type ResourceDependenciesBuilder<
  T extends ResourceTypes,
  IntrinsicParams extends Partial<T["params"]>,
  Dependencies extends Record<string, BaseResource | void>,
> = {
  deriveParams: <DepAwareParams extends Partial<T["params"]>>(
    deriveParams: (opts: {
      id: string;
      config: T["params"];
      deps: Dependencies;
    }) => DepAwareParams | Promise<DepAwareParams>,
  ) => ResourceClass<
    T,
    Dependencies,
    Omit<T["params"], keyof IntrinsicParams | keyof DepAwareParams>
  >;
};

export type ResourceClass<
  T extends ResourceTypes,
  D extends Record<string, BaseResource | void> = {},
  C extends Record<string, any> = T["params"],
  IntrinsicParams extends Partial<T["params"]> = {},
> = {
  new (opts: ResourceOpts<C, D>): Resource<T, D, C>;
  readonly type: ResourceType;
  requireDependencies: <
    Dependencies extends Record<string, BaseResource | void>,
  >() => ResourceDependenciesBuilder<T, IntrinsicParams, Dependencies>;
};

export type ResourceSchemaBuilder<T extends ResourceTypes> = {
  defineOperations: <IntrinsicParams extends Partial<T["params"]> = {}>(
    opts: ResourceOperationsOptions<T, IntrinsicParams>,
  ) => ResourceClass<
    T,
    {},
    Omit<T["params"], keyof IntrinsicParams>,
    IntrinsicParams
  >;
};

export type ResourceBuilder<ApiSchema extends DefineResourceApiSchema> = {
  defineSchema: <
    S extends Schema &
      SchemaFromApi<
        ApiSchema["Key"],
        ApiSchema["CreateParams"],
        Fallback<ApiSchema["UpdateParams"], ApiSchema["CreateParams"]>,
        Fallback<ApiSchema["ReadResult"], {}>
      >,
  >(
    schema: S,
  ) => ResourceSchemaBuilder<InferResourceTypes<ResolveSchema<ApiSchema, S>>>;
};

export function defineResource<ApiSchema extends DefineResourceApiSchema>(
  meta: DefineResourceMeta,
): ResourceBuilder<ApiSchema> {
  return {
    defineSchema<
      S extends Schema &
        SchemaFromApi<
          ApiSchema["Key"],
          ApiSchema["CreateParams"],
          Fallback<ApiSchema["UpdateParams"], ApiSchema["CreateParams"]>,
          Fallback<ApiSchema["ReadResult"], {}>
        >,
    >(
      schema: S,
    ): ResourceSchemaBuilder<InferResourceTypes<ResolveSchema<ApiSchema, S>>> {
      type T = InferResourceTypes<ResolveSchema<ApiSchema, S>>;
      // The cast skips re-relating this literal to ResourceSchemaBuilder:
      // defineOperations restates the declared signature verbatim, and
      // structurally verifying the deferred conditionals inside it costs
      // ~350ms of check time in every program that includes this file.
      const builder = {
        defineOperations<IntrinsicParams extends Partial<T["params"]> = {}>(
          opts: ResourceOperationsOptions<T, IntrinsicParams>,
        ): ResourceClass<
          T,
          {},
          Omit<T["params"], keyof IntrinsicParams>,
          IntrinsicParams
        > {
          class SimpleResource<
            D extends Record<string, BaseResource | void> = {},
            C extends Record<string, any> = Omit<
              T["params"],
              keyof IntrinsicParams
            >,
          > extends Resource<T, NoInfer<D>, NoInfer<C>> {
            static type = meta.type;
            type = meta.type;
            schema = schema;
            create = opts.create;
            read = opts.read ? opts.read : undefined;
            update = opts.update ? opts.update : undefined;
            delete = opts.delete;

            async deriveParams() {
              if (!opts.deriveParams) return {};
              return await opts.deriveParams({
                config: this.config as any as Partial<T["params"]>,
              });
            }

            static requireDependencies<
              Dependencies extends Record<string, BaseResource | void>,
            >() {
              return {
                deriveParams<DepAwareParams extends Partial<T["params"]>>(
                  deriveParams: (opts: {
                    id: string;
                    config: T["params"];
                    deps: Dependencies;
                  }) => DepAwareParams | Promise<DepAwareParams>,
                ) {
                  return class DependencyAwareResource extends SimpleResource<
                    Dependencies,
                    Omit<
                      T["params"],
                      keyof DepAwareParams | keyof IntrinsicParams
                    >
                  > {
                    async deriveParams() {
                      const superParams = await super.deriveParams();
                      return {
                        ...superParams,
                        ...(await deriveParams({
                          id: this.id,
                          config: this.config as T["params"],
                          deps: this.dependencies,
                        })),
                      };
                    }
                  };
                },
              };
            }
          }

          return SimpleResource as any;
        },
      };
      return builder as ResourceSchemaBuilder<
        InferResourceTypes<ResolveSchema<ApiSchema, S>>
      >;
    },
  };
}

// Backwards-compatible alias (existing code uses `resource()`)
export const resource = defineResource;
