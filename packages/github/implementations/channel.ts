import { defineGroup } from "@lightbox/notation-group";
import {
  type Channel as ChannelContract,
  channelConfig,
  type Connection as ConnectionContract,
} from "lightbox";
import * as v from "valibot";
import type { AppInstance } from "../resources/app.ts";
import { type IssueCommentRule, issueCommentRule, ruleKey } from "./rules.ts";

/**
 * What a channel needs of its connection: github's, with its App. A type,
 * not the Connection class, whose `channel()` returns this class: naming it
 * in this class's base would make the base refer to itself.
 */
type GithubConnection = ConnectionContract & {
  readonly parts: { app: AppInstance };
};

/**
 * A channel on a GitHub connection, made by `connection.channel(...)`.
 * Building it registers the channel with the router. Each rule then
 * contributes in two places: its matcher to the router's config, and the
 * events and permissions it needs to the connection's App.
 */
export class Channel
  extends defineGroup<ChannelContract>({ type: "github/Channel" })
    .defineSchema(channelConfig)
    .requireDependencies<{ connection: GithubConnection }>()
    .defineImplementation(({ config, deps }) => {
      const { connection } = deps;
      // The App's id is an output value, so the router's config depends on the App and gets its id at deploy.
      connection.dependencies.router.parts.store.contribute(
        {
          channels: {
            [config.name]: {
              provider: "github",
              scope: config.scope,
              source: connection.parts.app.out.id,
            },
          },
        },
        { by: `channel ${config.name}` },
      );
      return {};
    })
  implements ChannelContract
{
  /** Deliveries of comments on this channel's issues and pull requests that `rule` accepts. */
  onIssueComment(rule: IssueCommentRule): void {
    const match = v.parse(issueCommentRule, rule);
    const { name } = this.config;
    const { connection } = this.dependencies;
    const by = `channel ${name}`;
    connection.dependencies.router.parts.store.contribute(
      {
        rules: {
          [ruleKey(name, "issue_comment", match)]: {
            channel: name,
            provider: "github",
            event: "issue_comment",
            match,
          },
        },
      },
      { by },
    );
    connection.parts.app.contribute(
      { events: ["issue_comment"], permissions: { issues: "read" } },
      { by },
    );
  }
}
