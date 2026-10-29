import * as v from "valibot";

/** Who may start a run. Data, so the router can check it when a delivery arrives. */
const authorSet = v.variant("kind", [
  v.object({ kind: v.literal("collaborators") }),
  v.object({ kind: v.literal("team"), slug: v.string() }),
  v.object({ kind: v.literal("user"), login: v.string() }),
]);
export type AuthorSet = v.InferOutput<typeof authorSet>;

/** Users with write access to the repo. */
export const collaborators = (): AuthorSet => ({ kind: "collaborators" });
/** Members of a team, e.g. `"acme/core"`. */
export const team = (slug: string): AuthorSet => ({ kind: "team", slug });
/** One user, by login. */
export const user = (login: string): AuthorSet => ({ kind: "user", login });

/** Required: nothing is trusted by default. */
const from = v.union([authorSet, v.array(authorSet)]);

export const issueSelector = v.object({
  actions: v.optional(
    v.array(v.picklist(["opened", "edited", "reopened", "labeled"])),
    ["opened"],
  ),
  mention: v.optional(v.string()),
  labels: v.optional(v.array(v.string())),
  from,
});
export type IssueSelector = v.InferInput<typeof issueSelector>;

export const issueCommentSelector = v.object({
  actions: v.optional(v.array(v.picklist(["created", "edited"])), ["created"]),
  mention: v.optional(v.string()),
  labels: v.optional(v.array(v.string())),
  from,
});
export type IssueCommentSelector = v.InferInput<typeof issueCommentSelector>;

/** The parts of GitHub's webhook payloads worktree functions read. */
type User = { login: string };
type Issue = {
  number: number;
  title: string;
  body: string | null;
  labels: { name: string }[];
  user: User;
};
type Repository = { full_name: string; default_branch: string };

export type IssueEvent = {
  action: "opened" | "edited" | "reopened" | "labeled";
  issue: Issue;
  repository: Repository;
  sender: User;
};

export type IssueCommentEvent = {
  action: "created" | "edited";
  issue: Issue;
  comment: { id: number; body: string; user: User };
  repository: Repository;
  sender: User;
};
