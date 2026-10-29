import type { ResourceOpts } from "@notation/resource";
import * as v from "valibot";
import type { Channel, Selector } from "../contracts/channel.ts";
import type { Agent } from "../contracts/outpost.ts";
import type { Container } from "./container.ts";
import { OutpostGroup } from "./outpost.ts";

const triggerConfig = v.object({
  /** Where a worktree's branch is cut from if it doesn't exist yet. Default: the repo's default branch. */
  base: v.optional(v.string()),
});

export type TriggerConfig<E> = v.InferInput<typeof triggerConfig> & {
  event: Selector<E>;
  /**
   * Names the branch whose worktree the agent runs in, from the event.
   * Returning `undefined`, or leaving it out, means no branch: a scratch
   * worktree per conversation.
   */
  worktree?: (event: E) => string | undefined;
};

export type TriggerOptions<E> = ResourceOpts<
  TriggerConfig<E>,
  { agent: Agent; container: Container }
>;

/**
 * The whole dispatch rule: this event, from these authors, to this agent, in
 * this container, on the branch `worktree` names. The container is data, so
 * the router knows what to wake. Only the runner calls `worktree`, with the
 * real event, so it isn't in the outpost's config: the runner imports the
 * repo's config to call it.
 */
export class Trigger<E> extends OutpostGroup<
  TriggerConfig<E>,
  { agent: Agent; container: Container; channel: Channel }
> {
  constructor({ id, config, dependencies }: TriggerOptions<E>) {
    const { event, worktree } = config;
    const { base } = v.parse(triggerConfig, config);
    const { agent, container } = dependencies;
    if (base !== undefined && !worktree)
      throw new Error(`trigger ${id}: base is only used with a worktree`);
    if (!container.runtimes.some((r) => r.id === agent.runtime.id))
      throw new Error(
        `trigger ${id}: container ${container.id} doesn't list runtime ${agent.runtime.id}, which agent ${agent.id} needs`,
      );
    super("factory/Trigger", {
      id,
      config,
      dependencies: { ...dependencies, channel: event.channel },
    });
    this.dependencies.outpost.store.contribute(
      {
        triggers: {
          [id]: {
            channel: event.channel.id,
            event: event.event,
            match: event.match,
            agent: agent.id,
            container: container.id,
            ...(worktree && { worktree: { base } }),
          },
        },
      },
      { by: `trigger ${id}` },
    );
  }
}
