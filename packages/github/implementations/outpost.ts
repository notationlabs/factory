import { ConnectionRef } from "./connection-ref.ts";

export type { Channel } from "./channel.ts";
export type { ConnectionRef } from "./connection-ref.ts";
export { Policy, type PolicyOptions } from "./policy.ts";
export {
  type AuthorSet,
  collaborators,
  type IssueCommentEvent,
  type IssueCommentSelector,
  type IssueEvent,
  type IssueSelector,
  team,
  user,
} from "./selectors.ts";

/** In an outpost, `Connection` only has `get`: the connection itself is the hub's. */
export const Connection = {
  /** The connection the infra declares as `name`. */
  get: (name: string): ConnectionRef => new ConnectionRef(name, { name }),
};
