import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RuntimeRunner } from "@notation/factory";

/** One line of Cursor Agent's stream-json output. */
type StreamEvent = {
  type?: string;
  result?: string;
  is_error?: boolean;
  session_id?: string;
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

/** How the runner runs Cursor Agent. Containers import it with no packages, so it imports only Node's. */
const cursor: RuntimeRunner = {
  command: "agent",
  name: "Cursor Agent",
  transcripts: join(homedir(), ".cursor", "chats"),
  args: async (run, { systemPrompt }) => {
    const { agent } = run;
    // The CLI has no public flag for a system prompt, so the runner's
    // prompt, then the agent's, come before the conversation's messages.
    // stream-json writes a line for each event, so the runner can post the
    // agent's messages as it writes them.
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--force",
      "--trust",
      "--sandbox",
      "disabled",
      "--disable-auto-update",
      `${systemPrompt}\n\n${run.conversation.prompt}`,
    ];
    if (typeof agent.model === "string") args.push("--model", agent.model);
    if (agent.mode === "plan" || agent.mode === "ask") args.push("--mode", agent.mode);
    if (agent.settings && typeof agent.settings === "object") {
      // The CLI reads one config for the user, which a run merges for itself.
      const path = join(homedir(), ".cursor", "cli-config.json");
      await mkdir(dirname(path), { recursive: true });
      let current: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
      } catch {
        // The CLI creates the file itself when it has never run.
      }
      const settings = agent.settings as Record<string, unknown>;
      await writeFile(
        path,
        `${JSON.stringify(
          {
            version: 1,
            editor: { vimMode: false },
            permissions: { allow: [], deny: [] },
            ...current,
            ...settings,
          },
          null,
          2,
        )}\n`,
      );
    }
    return args;
  },
  resume: (sessionId) => ["--resume", sessionId],
  // A run that succeeds ends with a result event. A run that fails writes
  // the error to stderr and exits non-zero, with no result event.
  parse: (stdout) => {
    const lines = stdout.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const event = parseLine(lines[i]!);
      if (event?.type === "result") return { result: event.result, isError: event.is_error, sessionId: event.session_id };
    }
    return undefined;
  },
  // The message before a tool call carries model_call_id. It is that
  // message: the runner doesn't pass --stream-partial-output, so nothing
  // earlier in the stream has the same text. A subagent's text is nested
  // in the task tool's result, so it isn't an assistant message. A
  // thinking event has no text the conversation should see.
  message: (line) => {
    const event = parseLine(line);
    if (event?.type === "thinking") return "Thinking...";
    if (event?.type !== "assistant") return undefined;
    const text = (event.message?.content ?? []).flatMap((block) => (block.type === "text" && block.text ? [block.text] : []));
    return text.length ? text.join("\n\n") : undefined;
  },
};

export default cursor;
