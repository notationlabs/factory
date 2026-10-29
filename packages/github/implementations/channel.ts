import { ResourceGroup } from "@notation/resource";
import {
  type Channel as ChannelContract,
  type ChannelOptions,
  channelOptions,
} from "factory";
import * as v from "valibot";
import type { Connection } from "./connection.ts";
import { type IssueCommentRule, issueCommentRule, ruleKey } from "./rules.ts";

/**
 * A channel on a GitHub connection, made by `connection.channel(...)`.
 * Building it registers the channel with the router. Each rule then
 * contributes in two places: its matcher to the router's config, and the
 * events and permissions it needs to the connection's App.
 */
export class Channel extends ResourceGroup implements ChannelContract {
  readonly name: string;
  readonly connection: Connection;

  constructor(opts: ChannelOptions & { connection: Connection }) {
    const { name, scope } = v.parse(channelOptions, opts);
    super("github/Channel", {
      name,
      scope,
      dependencies: { connection: opts.connection.id },
    });
    this.name = name;
    this.connection = opts.connection;
    // The App's id is an output value, so the router's config depends on the App and gets its id at deploy.
    this.connection.router.store.contribute(
      {
        channels: {
          [name]: {
            provider: "github",
            scope,
            source: this.connection.app.out.id,
          },
        },
      },
      { by: `channel ${name}` },
    );
  }

  /** Deliveries of comments on this channel's issues and pull requests that `rule` accepts. */
  onIssueComment(rule: IssueCommentRule): void {
    const match = v.parse(issueCommentRule, rule);
    const by = `channel ${this.name}`;
    this.connection.router.store.contribute(
      {
        rules: {
          [ruleKey(this.name, "issue_comment", match)]: {
            channel: this.name,
            provider: "github",
            event: "issue_comment",
            match,
          },
        },
      },
      { by },
    );
    this.connection.app.contribute(
      { events: ["issue_comment"], permissions: { issues: "read" } },
      { by },
    );
  }
}
