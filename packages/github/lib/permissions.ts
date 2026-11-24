import type { DeepPartial } from "@notation/resource";
import * as v from "valibot";

export type Permission = "read" | "write";
export type Permissions = Partial<
  Record<
    | "actions"
    | "actions_variables"
    | "checks"
    | "contents"
    | "deployments"
    | "issues"
    | "metadata"
    | "pull_requests"
    | "statuses"
    | "workflows",
    Permission
  >
>;

const permission = v.picklist(["read", "write"]);

export const permissionsSchema = v.partial(
  v.object({
    actions: permission,
    actions_variables: permission,
    checks: permission,
    contents: permission,
    deployments: permission,
    issues: permission,
    metadata: permission,
    pull_requests: permission,
    statuses: permission,
    workflows: permission,
  }),
);

export type GithubEvent =
  | "issues"
  | "issue_comment"
  | "push"
  | "pull_request"
  | "pull_request_review_comment";

/** Combines event lists: each event once. */
export const union = (items: (GithubEvent[] | undefined)[]): GithubEvent[] => [
  ...new Set(items.flatMap((list) => list ?? [])),
];

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
