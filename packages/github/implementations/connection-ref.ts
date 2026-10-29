import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import type { ChannelOptions, ConnectionRef as ConnectionRefContract } from "factory";
import { Channel } from "./channel.ts";

/** In an outpost: a GitHub connection the infra declares, from `github.Connection.get(name)`. */
export class ConnectionRef extends ResourceGroup implements ConnectionRefContract {
  readonly name: string;

  constructor({ config }: ResourceOpts<{ name: string }, {}>) {
    super("github/ConnectionRef", { name: config.name });
    this.name = config.name;
  }

  /** A repo's issues. `scope` defaults to the outpost's repo. */
  channel(opts: ChannelOptions): Channel {
    return new Channel({ ...opts, dependencies: { connection: this } });
  }
}
