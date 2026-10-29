import type { ResourceOpts } from "@notation/resource";
import {
  type Channel as ChannelContract,
  OutpostGroup,
  type Selector,
} from "factory";
import * as v from "valibot";
import type { ConnectionRef } from "./connection-ref.ts";
import {
  type MentionEvent,
  type MentionOptions,
  mentionOptions,
} from "./selectors.ts";

/** A Slack channel needs naming: there's no default. */
const channelConfig = v.object({
  scope: v.pipe(v.string(), v.startsWith("#")),
});
export type ChannelConfig = v.InferInput<typeof channelConfig>;

export type ChannelOptions = { id: string } & ResourceOpts<ChannelConfig, {}>;

/**
 * One Slack channel on a Slack connection, made by `connection.channel(...)`.
 * Its grant is the bot's membership: `/invite @<app>` in the channel. A
 * conversation is a thread.
 */
export class Channel
  extends OutpostGroup<ChannelConfig, { connection: ConnectionRef }>
  implements ChannelContract
{
  readonly scope: string;
  readonly connection: ConnectionRef;

  constructor(
    id: string,
    {
      config,
      dependencies,
    }: ResourceOpts<ChannelConfig, { connection: ConnectionRef }>,
  ) {
    const { scope } = v.parse(channelConfig, config);
    super("slack/Channel", id, config, dependencies);
    this.scope = scope;
    this.connection = dependencies.connection;
    this.dependencies.outpost.store.contribute(
      {
        channels: {
          [id]: { provider: "slack", connection: this.connection.name, scope },
        },
      },
      { by: `channel ${id}` },
    );
  }

  /** Messages that mention `name`, e.g. `"@claude"`. */
  mention(name: string, opts: MentionOptions): Selector<MentionEvent> {
    return {
      channel: this,
      event: "app_mention",
      match: { mention: name, ...v.parse(mentionOptions, opts) },
    };
  }
}
