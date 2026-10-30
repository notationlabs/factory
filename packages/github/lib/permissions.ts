import type { DeepPartial } from "@notation/resource";

export type Permission = "read" | "write";
export type Permissions = Partial<
  Record<
    "actions_variables" | "contents" | "issues" | "metadata" | "pull_requests",
    Permission
  >
>;
export type GithubEvent =
  | "issues"
  | "issue_comment"
  | "push"
  | "pull_request"
  | "pull_request_review_comment";

/**
 * Combines event lists: each event once. Generic, like `mergeContributions`,
 * so it type-checks against the `Schema` constraint as well as the App's.
 */
export const union = <T extends GithubEvent[] | undefined>(
  items: DeepPartial<T>[],
): GithubEvent[] => {
  const lists = items as unknown as (GithubEvent[] | undefined)[];
  return [...new Set(lists.flatMap((list) => list ?? []))];
};

/** Combines permission sets: for each permission, write wins over read. */
export const highestPermissions = (
  items: DeepPartial<Permissions | undefined>[],
): Permissions => {
  const result: Permissions = {};
  for (const item of items) {
    for (const [name, level] of Object.entries(item ?? {}) as [
      keyof Permissions,
      Permission,
    ][]) {
      if (result[name] !== "write") result[name] = level;
    }
  }
  return result;
};
