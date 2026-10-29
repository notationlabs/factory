import {
  type ContributionSource,
  ContributionConflictError,
} from "@notation/resource";

/** A collected param only one contributor may set, e.g. an infra's one code host. */
export const single =
  (name: string) =>
  <V>(items: V[], from: ContributionSource[]): V => {
    if (items.length > 1) {
      throw new ContributionConflictError(name, from[0]!, from[1]!);
    }
    return items[0]!;
  };
