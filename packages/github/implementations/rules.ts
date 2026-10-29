import * as v from "valibot";

/** Who a rule accepts deliveries from. Data, so the router can check it when a delivery arrives. */
const actorFilter = v.variant("kind", [
  v.object({ kind: v.literal("collaborators") }),
  v.object({ kind: v.literal("users"), logins: v.array(v.string()) }),
]);
export type ActorFilter = v.InferOutput<typeof actorFilter>;

export const collaborators = (): ActorFilter => ({ kind: "collaborators" });
export const users = (...logins: string[]): ActorFilter => ({
  kind: "users",
  logins,
});

export const issueCommentRule = v.object({
  actions: v.array(v.picklist(["created", "edited", "deleted"])),
  mention: v.optional(v.string()),
  from: v.optional(actorFilter),
});
export type IssueCommentRule = v.InferInput<typeof issueCommentRule>;

/** A rule's key in the router's config, from its content: the same rule declared twice on one channel conflicts. */
export const ruleKey = (channel: string, event: string, match: unknown) =>
  `${channel}/${event}/${stableJson(match)}`;

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
};
