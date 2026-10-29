import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import type { ConnectionRef as ConnectionRefContract } from "factory";
import { Channel, type ChannelOptions } from "./channel.ts";

/** In an outpost: a Slack connection the infra declares, from `slack.Connection.get(name)`. */
export class ConnectionRef
  extends ResourceGroup
  implements ConnectionRefContract
{
  readonly name: string;

  constructor({ config }: ResourceOpts<{ name: string }, {}>) {
    super("slack/ConnectionRef", { name: config.name });
    this.name = config.name;
  }

  /** One Slack channel: `scope` is its name, e.g. `"#ops"`. */
  channel(opts: ChannelOptions): Channel {
    return new Channel({ ...opts, dependencies: { connection: this } });
  }
}
