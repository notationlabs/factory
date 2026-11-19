import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RuntimeRunner } from "@notation/factory";

/** One line of Droid's stream-json output. */
type StreamEvent = {
  type?: string;
  role?: string;
  text?: string;
  finalText?: string;
  message?: string;
  session_id?: string;
};

const parseLine = (line: string): StreamEvent | undefined => {
  if (!line.startsWith("{")) return undefined;
  try {
    return JSON.parse(line) as StreamEvent;
  } catch {
    return undefined;
  }
};

/** How the runner runs Droid. Containers import it with no packages, so it imports only Node's. */
const droid: RuntimeRunner = {
  command: "droid",
  name: "Droid",
  transcripts: join(homedir(), ".factory", "sessions"),
  args: async (run, { systemPrompt, dataDir }) => {
    const { agent } = run;
    // stream-json writes a line for each event, so the runner can post the
    // agent's messages as it writes them.
    const args = ["exec", run.conversation.prompt, "--output-format", "stream-json"];
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
  // A run that succeeds ends with a completion event. A run that fails ends
  // with an error event instead, and exits with code 1.
  parse: (stdout) => {
    const lines = stdout.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const event = parseLine(lines[i]!);
      if (event?.type === "completion") return { result: event.finalText, sessionId: event.session_id };
      if (event?.type === "error") return { result: event.message, isError: true, sessionId: event.session_id };
    }
    return undefined;
  },
  // Droid runs each subagent in a process of its own, so this output has
  // only the main session's messages. A subagent shows as a Task tool call.
  message: (line) => {
    const event = parseLine(line);
    return event?.type === "message" && event.role === "assistant" ? event.text : undefined;
  },
};

export default droid;
