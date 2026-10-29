import type { ResourceOpts } from "@notation/resource";
import {
  type Channel as ChannelContract,
  type ChannelConfig,
  channelConfig,
  OutpostGroup,
  type Selector,
} from "factory";
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
  extends OutpostGroup<ChannelConfig, { connection: ConnectionRef }>
  implements ChannelContract
{
  readonly scope: string;
  readonly connection: ConnectionRef;

  constructor({
    id,
    config,
    dependencies,
  }: ResourceOpts<ChannelConfig, { connection: ConnectionRef }>) {
    super("github/Channel", { id, config, dependencies });
    const { outpost } = this.dependencies;
    const { scope = outpost.repo } = v.parse(channelConfig, config ?? {});
    this.scope = scope;
    this.connection = dependencies.connection;
    outpost.store.contribute(
      {
        channels: {
          [id]: {
            provider: "github",
            connection: this.connection.name,
            scope,
          },
        },
      },
      { by: `channel ${id}` },
    );
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
