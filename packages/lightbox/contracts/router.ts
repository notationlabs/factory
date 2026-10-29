import type { Group } from "@lightbox/notation-group";
import type { BaseResource, Contributable } from "@notation/resource";
import type { WorkspaceEntry } from "../implementations/workspace.ts";
import type { ChannelEntry, RuleEntry } from "./channel.ts";

/** The router's config. Each section is keyed by its contributor's name. */
export type RouterConfig = {
  channels: Record<string, ChannelEntry>;
  rules: Record<string, RuleEntry>;
  workspaces: Record<string, WorkspaceEntry>;
};

/** Where the router is reached: any concrete resource with a `url` output. */
export type RouterApi = BaseResource & { output: { url: string } };

/**
 * Where the router's config is kept: any concrete resource that takes
 * contributions to it. BaseResource's own `contribute` is omitted because it
 * takes any record, which would let a contribution of any shape through.
 */
export type RouterConfigStore = Omit<BaseResource, "contribute"> &
  Contributable<RouterConfig>;

/**
 * Receives deliveries and routes them by its config. A provider decides
 * where each part lives (a Worker and a KV entry, …). The config's part is
 * `store`, so `router.parts.store` isn't confused with `router.config`, the
 * router's own options.
 */
export interface Router
  extends Group<{}, {}, { api: RouterApi; store: RouterConfigStore }> {}
