import { defineGroup } from "@lightbox/notation-group";
import * as v from "valibot";
import type { Channel } from "../contracts/channel.ts";

/** A workspace: the channel whose threads it claims, and the branches it works them on. */
export type WorkspaceEntry = { channel: string; branch: string; base: string };

/** Lightbox builds every workspace itself, whichever provider made its channel: it contributes its entry to the channel's router's config. */
export const Workspace = defineGroup({ type: "lightbox/Workspace" })
  .defineSchema(
    v.object({ name: v.string(), branch: v.string(), base: v.string() }),
  )
  .requireDependencies<{ channel: Channel }>()
  .defineImplementation(({ config: { name, branch, base }, deps }) => {
    const { channel } = deps;
    channel.dependencies.connection.dependencies.router.store.contribute(
      { workspaces: { [name]: { channel: channel.config.name, branch, base } } },
      { by: `workspace ${name}` },
    );
    return {};
  });

export type WorkspaceOptions = ConstructorParameters<typeof Workspace>[0];
