import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import {
  type Channel as ChannelContract,
  currentOutpost,
  type Selector,
} from "factory";
import * as v from "valibot";
import type { ConnectionRef } from "./connection-ref.ts";
import { type MentionEvent, type MentionOptions, mentionOptions } from "./selectors.ts";

/** A Slack channel needs naming: there's no default. */
const channelConfig = v.object({ scope: v.pipe(v.string(), v.startsWith("#")) });

export type ChannelOptions = ResourceOpts<v.InferInput<typeof channelConfig>, {}>;

/**
 * One Slack channel on a Slack connection, made by `connection.channel(...)`.
 * Its grant is the bot's membership: `/invite @<app>` in the channel. A
 * conversation is a thread.
 */
export class Channel extends ResourceGroup implements ChannelContract {
  readonly key: string;
  readonly scope: string;
  readonly connection: ConnectionRef;

  constructor({
    id,
    config,
    dependencies,
  }: ResourceOpts<v.InferInput<typeof channelConfig>, { connection: ConnectionRef }>) {
    const { scope } = v.parse(channelConfig, config);
    super("slack/Channel", {
      key: id,
      scope,
      dependencies: { connection: dependencies.connection.id },
    });
    this.key = id;
    this.scope = scope;
    this.connection = dependencies.connection;
    currentOutpost().store.contribute(
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
