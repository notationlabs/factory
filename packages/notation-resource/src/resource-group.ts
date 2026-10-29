import type { BaseResource } from "./resource";
import {
  getActiveResourceCollection,
  type ResourceGraph,
} from "./resource-collection";

/** The groups a group uses, by name. Like a resource's dependencies, they're references, not ids. */
export type GroupDependencies = Record<
  string,
  ResourceGroup | ResourceGroup[] | undefined
>;

export type ResourceGroupOptions<
  C extends Record<string, any> = Record<string, any>,
  D extends GroupDependencies = GroupDependencies,
> = {
  /**
   * Identifies the group across deployments. Must be unique among groups of
   * the same type.
   */
  id: string;

  config?: C;
  dependencies?: D;
};

export abstract class ResourceGroup<
  C extends Record<string, any> = Record<string, any>,
  D extends GroupDependencies = GroupDependencies,
> {
  readonly type: string;
  readonly id: string;
  readonly config: C;
  readonly dependencies: D;
  readonly resources: BaseResource[];

  #graph?: ResourceGraph;

  constructor(type: string, opts: ResourceGroupOptions<C, D>) {
    const { id, config, dependencies } = opts;
    const collection = getActiveResourceCollection();
    if (
      collection?.graph.resourceGroups.some(
        (group) => group.type === type && group.id === id,
      )
    ) {
      throw new Error(
        `Duplicate ${type} id "${id}": another ${type} group in this deployment already uses it.`,
      );
    }
    this.type = type;
    this.id = id;
    this.#graph = collection?.graph;
    this.config = config || ({} as C);
    this.dependencies = dependencies || ({} as D);
    this.resources = [];

    collection?.graph.resourceGroups.push(this);
    return this;
  }

  add<T extends BaseResource>(resource: T) {
    if (this.#graph) {
      if (this.#graph.resources.includes(resource)) {
        throw new Error(
          `Resource ${resource.type} has already been registered.`,
        );
      }
      this.#graph.resources.push(resource);
    } else if (this.resources.includes(resource)) {
      throw new Error(`Resource ${resource.type} has already been registered.`);
    }
    resource.group = { type: this.type, id: this.id };
    this.resources.push(resource);
    return resource;
  }

  /**
   * Adds a resource unless the group already has one with the same ID, and
   * returns the one the group holds. Use it for resources that bind two
   * others, such as an API integration, which several call sites may create.
   */
  addOnce<T extends new (opts: any) => BaseResource>(
    ResourceClass: T,
    opts: ConstructorParameters<T>[0] & { id: string },
  ): InstanceType<T> {
    const existing = this.resources.find((r) => r.id === opts.id);
    if (!existing) {
      return this.add(new ResourceClass(opts) as InstanceType<T>);
    }
    if (existing.constructor !== ResourceClass) {
      throw new Error(
        `Resource ${opts.id} already exists as ${existing.type} in group ${this.type}.`,
      );
    }
    return existing as InstanceType<T>;
  }
}
