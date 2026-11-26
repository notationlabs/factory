import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RuntimeRunner } from "@notation/factory";

/** One line of Droid's stream-json output. */
type StreamEvent = {
  type?: string;
  subtype?: string;
  model?: string;
  role?: string;
  text?: string;
  finalText?: string;
  message?: string;
  session_id?: string;
  toolName?: string;
  parameters?: unknown;
};

const parseLine = (line: string): StreamEvent | undefined => {
  if (!line.startsWith("{")) return undefined;
  try {
    return JSON.parse(line) as StreamEvent;
  } catch {
    return undefined;
  }
};

/**
 * Sets Droid's user setting `showThinkingInMainView`. Without it, Droid asks
 * Claude models for thinking as progress updates, and writes them as
 * assistant messages that the output can't tell apart from the agent's
 * text. With it, all thinking comes as reasoning events. Droid reads the
 * setting only from the user's settings, not from `--settings`, and only when
 * it creates a session.
 */
const hideThinking = async (configDir: string) => {
  const path = join(configDir, "settings.json");
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
  } catch {
    // Droid creates the file itself when it has never run.
  }
  if (current.showThinkingInMainView === true) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ ...current, showThinkingInMainView: true }, null, 2)}\n`);
};

/** The input's main argument, such as a shell command or a file's path, or else the whole input as JSON. */
const mainArgument = (input: unknown) => {
  if (!input || typeof input !== "object") return typeof input === "string" ? input : undefined;
  const fields = input as Record<string, unknown>;
  for (const key of ["command", "file_path", "directory_path", "pattern", "url", "query", "description", "prompt"]) {
    if (typeof fields[key] === "string") return fields[key];
  }
  return JSON.stringify(input);
};

/** How the runner runs Droid. Containers import it with no packages, so it imports only Node's. */
const droid: RuntimeRunner = {
  command: "droid",
  name: "Droid",
  configDir: ".factory",
  // Droid has no variable for its config directory, but reads it from
  // `.factory` under FACTORY_HOME_OVERRIDE in place of the home.
  configEnv: (dir) => ({ FACTORY_HOME_OVERRIDE: dirname(dir) }),
  transcripts: "sessions",
  args: async (run, { systemPrompt, dataDir, configDir }) => {
    const { agent } = run;
    await hideThinking(configDir);
    // exec reads the prompt from stdin. stream-json writes a line for each
    // event, so the runner can post the agent's messages as it writes them.
    const args = ["exec", "--output-format", "stream-json"];
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
  // The conversation sees that the agent is thinking, but not its thoughts.
  message: (line) => {
    const event = parseLine(line);
    if (event?.type === "reasoning") return "Thinking...";
    return event?.type === "message" && event.role === "assistant" ? event.text : undefined;
  },
  model: (line) => {
    const event = parseLine(line);
    return event?.type === "system" && event.subtype === "init" ? event.model : undefined;
  },
  session: (line) => parseLine(line)?.session_id,
  tools: (line) => {
    const event = parseLine(line);
    return event?.type === "tool_call" && event.toolName
      ? [{ name: event.toolName, argument: mainArgument(event.parameters) }]
      : [];
  },
};

export default droid;
