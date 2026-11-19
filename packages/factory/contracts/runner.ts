import type { Run } from "../router/run.ts";

/**
 * A plugin's runner module is TypeScript that the hub serves to its
 * containers, and the runner imports for the runs that need it. A
 * container has no packages, so the module imports only Node's built-ins,
 * and types. Its default export is a `RuntimeRunner` or a `CodeHostRunner`.
 */

/** What the runner gives a runtime for one run. */
export type RunContext = {
  /** The run's worktree. */
  cwd: string;
  /** The runner's system prompt, followed by the agent's own. */
  systemPrompt: string;
  /** The runner's state directory, `/data`. */
  dataDir: string;
};

/** What a runtime's CLI said at the end of a run. */
export type RuntimeOutput = { result?: string; isError?: boolean; sessionId?: string };

/** How the runner runs a runtime's CLI: a runtime's runner module. */
export type RuntimeRunner = {
  /** The command the image must have. */
  command: string;
  /** The CLI's name, for errors. */
  name: string;
  /** Where the CLI keeps its sessions' transcripts, in a directory per working directory. */
  transcripts: string;
  /** The CLI's arguments for a run. */
  args(run: Run, context: RunContext): Promise<string[]>;
  /** The arguments that resume a session. */
  resume(sessionId: string): string[];
  /** Reads the CLI's output. Returns undefined if it isn't the CLI's output. */
  parse(stdout: string): RuntimeOutput | undefined;
  /**
   * Reads one line of the CLI's output while it runs, and returns the text
   * of the agent's message on that line, if it has one. The runner posts
   * each message in place of the last, until the final reply replaces
   * them. Without it, the runner posts only the final reply.
   */
  message?(line: string): string | undefined;
  /** Extra environment for the CLI. */
  env?: Record<string, string>;
};

/**
 * How the runner reaches the code host: the code host's runner module. Runs
 * get the path of a file that holds the repo's token, as
 * `FACTORY_TOKEN_FILE`, which the router refreshes during long runs.
 */
export type CodeHostRunner = {
  /** The URL that the runner clones `repo` from. */
  cloneUrl(repo: string): string;
  /** Git's options that authenticate one command with `token`, without keeping it in the repo's config. */
  gitAuth(token: string): string[];
  /**
   * Sets up git, and the code host's CLI if the image has it, to read the
   * token in `FACTORY_TOKEN_FILE`. `bin` is first on the agent's PATH, for
   * wrappers. The runner calls it once for each version of the module.
   */
  setup(context: { bin: string }): Promise<void>;
};
