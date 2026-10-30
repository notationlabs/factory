import {
  type CollectContext,
  ContributionConflictError,
  type DeepPartial,
} from "@notation/resource";

/** A collected param only one contributor may set, e.g. an infra's one code host. */
export const single = <T>(
  items: DeepPartial<T>[],
  context: CollectContext,
): T => {
  if (items.length > 1) {
    throw new ContributionConflictError(
      context.resourceId,
      context.param,
      [context.contributors[0]!, context.contributors[1]!],
      [items[0], items[1]],
    );
  }
  return items[0] as T;
};
