import * as v from "valibot";

/** Who may start a run. Data, so the router can check it when an event arrives. */
const authorSet = v.variant("kind", [
  v.object({ kind: v.literal("group"), handle: v.string() }),
  v.object({ kind: v.literal("user"), email: v.string() }),
]);
export type AuthorSet = v.InferOutput<typeof authorSet>;

/** Members of a Slack user group, by handle. */
export const group = (handle: string): AuthorSet => ({ kind: "group", handle });
/** One user, by email. */
export const user = (email: string): AuthorSet => ({ kind: "user", email });

export const mentionOptions = v.object({
  from: v.union([authorSet, v.array(authorSet)]),
});
export type MentionOptions = v.InferInput<typeof mentionOptions>;

/** The parts of Slack's `app_mention` event worktree functions read. */
export type MentionEvent = {
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
};
