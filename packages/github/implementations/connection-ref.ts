import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import type {
  ChannelOptions,
  ConnectionRef as ConnectionRefContract,
} from "factory";
import { Channel } from "./channel.ts";

type ConnectionRefConfig = { name: string };

/** In an outpost: a GitHub connection the infra declares, from `github.Connection.get(name)`. */
export class ConnectionRef
  extends ResourceGroup<ConnectionRefConfig>
  implements ConnectionRefContract
{
  readonly name: string;

  constructor({ id, config }: ResourceOpts<ConnectionRefConfig, {}>) {
    super("github/ConnectionRef", { id, config });
    this.name = config.name;
  }

  /** A repo's issues. `scope` defaults to the outpost's repo. */
  channel(opts: ChannelOptions): Channel {
    return new Channel({ ...opts, dependencies: { connection: this } });
  }
}
