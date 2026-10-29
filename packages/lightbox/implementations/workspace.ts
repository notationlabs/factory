import { ResourceGroup } from "@notation/resource";
import * as v from "valibot";
import type { Channel } from "../contracts/channel.ts";

/** A workspace: the channel whose threads it claims, and the branches it works them on. */
export type WorkspaceEntry = { channel: string; branch: string; base: string };

const workspaceOptions = v.object({
  name: v.string(),
  branch: v.string(),
  base: v.string(),
});
export type WorkspaceOptions = v.InferInput<typeof workspaceOptions> & {
  channel: Channel;
};

/** Lightbox builds every workspace itself, whichever provider made its channel: it contributes its entry to the channel's router's config. */
export class Workspace extends ResourceGroup {
  readonly name: string;
  readonly channel: Channel;

  constructor(opts: WorkspaceOptions) {
    const { name, branch, base } = v.parse(workspaceOptions, opts);
    super("lightbox/Workspace", {
      name,
      branch,
      base,
      dependencies: { channel: opts.channel.id },
    });
    this.name = name;
    this.channel = opts.channel;
    this.channel.connection.router.store.contribute(
      { workspaces: { [name]: { channel: this.channel.name, branch, base } } },
      { by: `workspace ${name}` },
    );
  }
}
