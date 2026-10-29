import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import * as v from "valibot";
import type { Channel } from "../contracts/channel.ts";

/** A workspace: the channel whose threads it claims, and the branches it works them on. */
export type WorkspaceEntry = { channel: string; branch: string; base: string };

const workspaceConfig = v.object({
  name: v.string(),
  branch: v.string(),
  base: v.string(),
});
export type WorkspaceOptions = ResourceOpts<
  v.InferInput<typeof workspaceConfig>,
  { channel: Channel }
>;

/** Lightbox builds every workspace itself, whichever provider made its channel: it contributes its entry to the channel's router's config. */
export class Workspace extends ResourceGroup {
  readonly name: string;
  readonly channel: Channel;

  constructor({ config, dependencies }: WorkspaceOptions) {
    const { name, branch, base } = v.parse(workspaceConfig, config);
    super("lightbox/Workspace", {
      name,
      branch,
      base,
      dependencies: { channel: dependencies.channel.id },
    });
    this.name = name;
    this.channel = dependencies.channel;
    this.channel.connection.router.store.contribute(
      { workspaces: { [name]: { channel: this.channel.name, branch, base } } },
      { by: `workspace ${name}` },
    );
  }
}
