import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import { type Agent as AgentContract, currentOutpost } from "lightbox";
import * as v from "valibot";
import { runtime } from "./runtime.ts";

const agentConfig = v.object({
  model: v.string(),
  effort: v.optional(v.picklist(["low", "medium", "high", "xhigh", "max"])),
  /** Relative to `.lightbox/`. Appended to the runner's prompt. */
  systemPrompt: v.optional(v.string()),
  /** Merged into `/data/agents/<id>/settings.json`. */
  settings: v.optional(v.record(v.string(), v.unknown())),
  /** `~/.claude/*` is written to `/data/agents/<id>/`, other `~/*` to `/data/home/`. */
  files: v.optional(v.record(v.string(), v.string())),
});

export type AgentOptions = ResourceOpts<v.InferInput<typeof agentConfig>, {}>;

/** A Claude Code agent. A trigger that runs it must target a container that lists `claude.runtime`. */
export class Agent extends ResourceGroup implements AgentContract {
  readonly key: string;
  readonly runtime = runtime;

  constructor({ id, config }: AgentOptions) {
    const settings = v.parse(agentConfig, config);
    super("claude/Agent", { key: id, ...settings });
    this.key = id;
    currentOutpost().store.contribute(
      { agents: { [id]: { runtime: runtime.id, ...settings } } },
      { by: `agent ${id}` },
    );
  }
}
