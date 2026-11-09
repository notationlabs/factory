import { type Agent as AgentContract, OutpostGroup } from "@notation/factory";
import * as v from "valibot";
import { runtime } from "./runtime.ts";

const agentConfig = v.object({
  model: v.string(),
  effort: v.optional(v.picklist(["low", "medium", "high", "xhigh", "max"])),
  /** Relative to `.factory/`. Appended to the runner's prompt. */
  systemPrompt: v.optional(v.string()),
  /** Merged into `/data/agents/<id>/settings.json`. */
  settings: v.optional(v.record(v.string(), v.unknown())),
  /** `~/.claude/*` is written to `/data/agents/<id>/`, other `~/*` to `/data/home/`. */
  files: v.optional(v.record(v.string(), v.string())),
});
export type AgentConfig = v.InferInput<typeof agentConfig>;

export type AgentOptions = AgentConfig;

/** A Claude Code agent. A trigger that runs it must target a container that lists `claude.runtime`. */
export class Agent extends OutpostGroup<AgentConfig> implements AgentContract {
  readonly runtime = runtime;

  constructor(id: string, config: AgentOptions) {
    const settings = v.parse(agentConfig, config);
    super("claude/Agent", id, config);
    this.outpost.store.contribute({
      agents: { [id]: { runtime: runtime.id, ...settings } },
    });
  }
}
