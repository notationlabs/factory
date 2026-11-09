import {
  type Channel as ChannelContract,
  type ChannelConfig,
  channelConfig,
  OutpostGroup,
  type Selector,
} from "@notation/factory";
import * as v from "valibot";
import type { ConnectionRef } from "./connection-ref.ts";
import {
  type IssueCommentEvent,
  type IssueCommentSelector,
  issueCommentSelector,
  type IssueEvent,
  type IssueSelector,
  issueSelector,
} from "./selectors.ts";

/**
 * A repo's issues on a GitHub connection, made by `connection.channel(...)`.
 * Its grant is the App's installation on the repo. Its selectors are data the
 * router matches; a conversation is an issue.
 */
export class Channel
  extends OutpostGroup<ChannelConfig>
  implements ChannelContract
{
  readonly scope: string;
  readonly connection: ConnectionRef;

  constructor(
    id: string,
    { connection, ...config }: ChannelConfig & { connection: ConnectionRef },
  ) {
    super("github/Channel", id, config);
    const { outpost } = this;
    const { scope = outpost.repo } = v.parse(channelConfig, config);
    this.scope = scope;
    this.connection = connection;
    outpost.store.contribute({
      channels: {
        [id]: {
          provider: "github",
          connection: this.connection.name,
          scope,
        },
      },
    });
  }

  /** Issue events. `actions` defaults to `["opened"]`. */
  issue(opts: IssueSelector): Selector<IssueEvent> {
    return {
      channel: this,
      event: "issues",
      match: v.parse(issueSelector, opts),
    };
  }

  /** Comments on issues and pull requests. `actions` defaults to `["created"]`; with `"edited"`, only edits that newly add `mention` match. */
  issueComment(opts: IssueCommentSelector): Selector<IssueCommentEvent> {
    return {
      channel: this,
      event: "issue_comment",
      match: v.parse(issueCommentSelector, opts),
    };
  }
}
