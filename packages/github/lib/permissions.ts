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

/** Combines lists: each value once, in contribution order. */
export const union = <V>(items: V[][]): V[] => [...new Set(items.flat())];

/** Combines permission sets: for each permission, write wins over read. */
export const highestPermissions = (items: Permissions[]): Permissions => {
  const result: Permissions = {};
  for (const item of items)
    for (const [name, level] of Object.entries(item) as [
      keyof Permissions,
      Permission,
    ][])
      if (result[name] !== "write") result[name] = level;
  return result;
};
