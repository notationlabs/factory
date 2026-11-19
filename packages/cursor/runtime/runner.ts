import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RuntimeRunner } from "@notation/factory";

/** How the runner runs Cursor Agent. Containers import it with no packages, so it imports only Node's. */
const cursor: RuntimeRunner = {
  command: "agent",
  name: "Cursor Agent",
  transcripts: join(homedir(), ".cursor", "chats"),
  args: async (run, { systemPrompt }) => {
    const { agent } = run;
    // The CLI has no public flag for a system prompt, so the runner's
    // prompt, then the agent's, come before the conversation's messages.
    const args = [
      "-p",
      "--output-format",
      "json",
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
  parse: (stdout) => {
    try {
      const output = JSON.parse(stdout) as { result?: string; is_error?: boolean; session_id?: string };
      return { result: output.result, isError: output.is_error, sessionId: output.session_id };
    } catch {
      return undefined;
    }
  },
};

export default cursor;
