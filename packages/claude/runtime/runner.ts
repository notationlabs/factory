import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeRunner } from "@notation/factory";

// Claude Code removes CLAUDE_CODE_OAUTH_TOKEN from the commands the agent runs, so
// a `claude` started by one of them isn't signed in. Claude Code runs CLAUDE_ENV_FILE
// before each command, so exporting the token there puts it back.
function envFile(): Record<string, string> {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) return {};
  const file = join(mkdtempSync(join(tmpdir(), "claude-env-")), "env.sh");
  writeFileSync(file, `export CLAUDE_CODE_OAUTH_TOKEN='${token.replaceAll("'", "'\\''")}'\n`, { mode: 0o600 });
  return { CLAUDE_ENV_FILE: file };
}

/** One line of Claude Code's stream-json output. */
type StreamEvent = {
  type?: string;
  result?: string;
  is_error?: boolean;
  session_id?: string;
  parent_tool_use_id?: string | null;
  message?: { content?: { type: string; text?: string }[] };
};

const parseLine = (line: string): StreamEvent | undefined => {
  if (!line.startsWith("{")) return undefined;
  try {
    return JSON.parse(line) as StreamEvent;
  } catch {
    return undefined;
  }
};

/** How the runner runs Claude Code. Containers import it with no packages, so it imports only Node's. */
const claude: RuntimeRunner = {
  command: "claude",
  name: "Claude Code",
  transcripts: join(homedir(), ".claude", "projects"),
  args: async (run, { prompt, systemPrompt }) => {
    const { agent } = run;
    // stream-json writes a line for each event, so the runner can post the
    // agent's messages as it writes them. It needs --verbose in print mode.
    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];
    if (typeof agent.model === "string") args.push("--model", agent.model);
    if (typeof agent.effort === "string") args.push("--effort", agent.effort);
    args.push("--append-system-prompt", systemPrompt);
    if (agent.settings) args.push("--settings", JSON.stringify(agent.settings));
    return args;
  },
  resume: (sessionId) => ["--resume", sessionId],
  parse: (stdout) => {
    const lines = stdout.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const event = parseLine(lines[i]!);
      if (event?.type === "result") return { result: event.result, isError: event.is_error, sessionId: event.session_id };
    }
    return undefined;
  },
  // A message with a parent tool use is a subagent's, which the conversation
  // doesn't see. The conversation sees that the agent is thinking, but not
  // its thoughts.
  message: (line) => {
    const event = parseLine(line);
    if (event?.type !== "assistant" || event.parent_tool_use_id) return undefined;
    const content = event.message?.content ?? [];
    const text = content.flatMap((block) => (block.type === "text" && block.text ? [block.text] : []));
    if (text.length) return text.join("\n\n");
    return content.some((block) => block.type === "thinking" || block.type === "redacted_thinking") ? "Thinking..." : undefined;
  },
  env: { DISABLE_AUTOUPDATER: "1", ...envFile() },
};

export default claude;
