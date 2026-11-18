import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RuntimeRunner } from "@notation/factory";

/** How the runner runs Droid. Containers import it with no packages, so it imports only Node's. */
const droid: RuntimeRunner = {
  command: "droid",
  name: "Droid",
  transcripts: join(homedir(), ".factory", "sessions"),
  args: async (run, { systemPrompt, dataDir }) => {
    const { agent } = run;
    const args = ["exec", run.conversation.prompt, "--output-format", "json"];
    // A container is disposable, so a run skips every permission prompt
    // unless the agent sets an autonomy level.
    if (typeof agent.autonomy === "string") args.push("--auto", agent.autonomy);
    else args.push("--skip-permissions-unsafe");
    if (typeof agent.model === "string") args.push("--model", agent.model);
    if (typeof agent.effort === "string") args.push("--reasoning-effort", agent.effort);
    args.push("--append-system-prompt", systemPrompt);
    if (agent.settings) {
      // `--settings` takes a file, which a run merges for that run only.
      const path = join(dataDir, "agents", agent.id, "settings.json");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(agent.settings, null, 2)}\n`);
      args.push("--settings", path);
    }
    return args;
  },
  resume: (sessionId) => ["--session-id", sessionId],
  parse: (stdout) => {
    try {
      const output = JSON.parse(stdout) as { result?: string; is_error?: boolean; session_id?: string };
      return { result: output.result, isError: output.is_error, sessionId: output.session_id };
    } catch {
      return undefined;
    }
  },
};

export default droid;
