import { ResourceGroup } from "@notation/resource";
import type {
  ChannelOptions,
  ConnectionRef as ConnectionRefContract,
} from "@notation/factory";
import { Channel } from "./channel.ts";

type ConnectionRefConfig = { name: string };

/** In an outpost: a GitHub connection the infra declares, from `github.Connection.get(name)`. */
export class ConnectionRef
  extends ResourceGroup<ConnectionRefConfig>
  implements ConnectionRefContract
{
  readonly name: string;

  constructor(id: string, config: ConnectionRefConfig) {
    super("github/ConnectionRef", id, config);
    this.name = config.name;
  }

  /** A repo's issues. `scope` defaults to the outpost's repo. */
  channel({ id, ...config }: ChannelOptions): Channel {
    return new Channel(id, { ...config, connection: this });
  }
}
