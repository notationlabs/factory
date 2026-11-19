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

/** How the runner runs Claude Code. Containers import it with no packages, so it imports only Node's. */
const claude: RuntimeRunner = {
  command: "claude",
  name: "Claude Code",
  transcripts: join(homedir(), ".claude", "projects"),
  args: async (run, { systemPrompt }) => {
    const { agent } = run;
    const args = ["-p", run.conversation.prompt, "--output-format", "json", "--dangerously-skip-permissions"];
    if (typeof agent.model === "string") args.push("--model", agent.model);
    if (typeof agent.effort === "string") args.push("--effort", agent.effort);
    args.push("--append-system-prompt", systemPrompt);
    if (agent.settings) args.push("--settings", JSON.stringify(agent.settings));
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
  env: { DISABLE_AUTOUPDATER: "1", ...envFile() },
};

export default claude;
