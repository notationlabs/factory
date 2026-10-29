import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import * as v from "valibot";
import type { Channel } from "../contracts/channel.ts";

/** A workspace: the channel whose threads it claims, and the branches it works them on. */
export type WorkspaceEntry = { channel: string; branch: string; base: string };

const workspaceConfig = v.object({ branch: v.string(), base: v.string() });
export type WorkspaceOptions = ResourceOpts<
  v.InferInput<typeof workspaceConfig>,
  { channel: Channel }
>;

/** Factory builds every workspace itself, whichever provider made its channel: it contributes its entry to the channel's router's config. */
export class Workspace extends ResourceGroup {
  /** The id it was constructed with, which keys it in the router's config. */
  readonly key: string;
  readonly channel: Channel;

  constructor({ id, config, dependencies }: WorkspaceOptions) {
    const { branch, base } = v.parse(workspaceConfig, config);
    super("factory/Workspace", {
      key: id,
      branch,
      base,
      dependencies: { channel: dependencies.channel.id },
    });
    this.key = id;
    this.channel = dependencies.channel;
    this.channel.connection.router.store.contribute(
      { workspaces: { [id]: { channel: this.channel.key, branch, base } } },
      { by: `workspace ${id}` },
    );
  }
}
