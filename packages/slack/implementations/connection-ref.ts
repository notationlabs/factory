import { ResourceGroup } from "@notation/resource";
import type { ConnectionRef as ConnectionRefContract } from "factory";
import { Channel, type ChannelOptions } from "./channel.ts";

type ConnectionRefConfig = { name: string };

/** In an outpost: a Slack connection the infra declares, from `slack.Connection.get(name)`. */
export class ConnectionRef
  extends ResourceGroup<ConnectionRefConfig>
  implements ConnectionRefContract
{
  readonly name: string;

  constructor(id: string, config: ConnectionRefConfig) {
    super("slack/ConnectionRef", id, config);
    this.name = config.name;
  }

  /** One Slack channel: `scope` is its name, e.g. `"#ops"`. */
  channel({ id, ...config }: ChannelOptions): Channel {
    return new Channel(id, { ...config, connection: this });
  }
}
