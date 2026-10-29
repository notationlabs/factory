import type { ResourceGroup } from "@notation/resource";
import type { ChannelEntry } from "./channel.ts";

/** What a container's image installs to run a kind of agent. `setup` is a directory holding `setup.sh`, run at image build. */
export type Runtime = { id: string; setup: string };

/** An agent persona for a runtime. Its provider decides its settings. */
export interface Agent extends ResourceGroup {
  readonly key: string;
  readonly runtime: Runtime;
}

/** Credentials a container may ask the router for. `provider` names what mints them (e.g. "github": the code host). */
export interface PolicyContract extends ResourceGroup {
  readonly key: string;
  readonly provider: string;
}

/** In an outpost's config: a container, with its runtimes' and policies' ids. */
export type ContainerEntry = {
  image: string;
  runtimes: string[];
  policies: string[];
  files: Record<string, string | Record<string, unknown>>;
};

/** In an outpost's config: a policy. The rest is its provider's. */
export type PolicyEntry = { provider: string } & Record<string, unknown>;

/** In an outpost's config: an agent. The rest is its runtime's settings. */
export type AgentEntry = { runtime: string } & Record<string, unknown>;

/**
 * In an outpost's config: the whole dispatch rule. A delivery of `event` on
 * `channel` that `match` accepts runs `agent` in `container`. With `worktree`,
 * the runner names its branch from the event, cut from `base`: the function
 * isn't data, so the runner imports the config to call it.
 */
export type TriggerEntry = {
  channel: string;
  event: string;
  match: unknown;
  agent: string;
  container: string;
  worktree?: { base?: string };
};

/** An outpost's config, keyed by each resource's id. */
export type OutpostConfig = {
  channels: Record<string, ChannelEntry>;
  containers: Record<string, ContainerEntry>;
  policies: Record<string, PolicyEntry>;
  agents: Record<string, AgentEntry>;
  triggers: Record<string, TriggerEntry>;
};
