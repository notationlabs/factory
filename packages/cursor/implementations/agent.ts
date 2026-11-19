import { type Agent as AgentContract, OutpostGroup } from "@notation/factory";
import * as v from "valibot";
import { runtime } from "./runtime.ts";

const agentConfig = v.object({
  /**
   * Passed as `--model`. A parameterized model takes its parameters in
   * brackets, such as `claude-opus-4-8[effort=high]`.
   */
  model: v.string(),
  /**
   * `plan` and `ask` are read-only. Without it, the CLI edits and runs
   * commands, which is its default mode. `agent` is that default, and the
   * CLI rejects it as a `--mode` value.
   */
  mode: v.optional(v.picklist(["plan", "ask"])),
  /** Relative to `.factory/`. Appended to the runner's prompt. */
  systemPrompt: v.optional(v.string()),
  /** Merged into `/data/agents/<id>/.cursor/cli-config.json` before each run. */
  settings: v.optional(v.record(v.string(), v.unknown())),
  /** `~/.cursor/*` is written to `/data/agents/<id>/.cursor/`, other `~/*` to `/data/home/`. Relative to `.factory/`. */
  files: v.optional(v.record(v.string(), v.string())),
});
export type AgentConfig = v.InferInput<typeof agentConfig>;

export type AgentOptions = AgentConfig;

/** A Cursor Agent. A trigger that runs it must target a container that lists `cursor.runtime`. */
export class Agent extends OutpostGroup<AgentConfig> implements AgentContract {
  readonly runtime = runtime;

  constructor(id: string, config: AgentOptions) {
    const settings = v.parse(agentConfig, config);
    super("cursor/Agent", id, config);
    this.outpost.store.contribute({
      agents: { [id]: { runtime: runtime.id, ...settings } },
    });
  }
}
