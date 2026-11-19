import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Runs `command` in a shell, with the terminal's input and output. */
export const shell = (command: string, cwd = process.cwd()) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with ${code}`)),
    );
  });

/** Runs a program and returns its output. */
export const output = (file: string, args: string[], cwd = process.cwd()) =>
  new Promise<string>((resolve, reject) =>
    execFile(file, args, { cwd }, (error, stdout, stderr) =>
      error
        ? reject(new Error(`${file} ${args.join(" ")}: ${stderr.trim() || error.message}`))
        : resolve(stdout.trim()),
    ),
  );

export const openBrowser = (url: string) => {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer"
        : "xdg-open";
  execFile(cmd, [url], () => {});
};

/** A hub's `factory.config.ts`. */
export type HubConfig = {
  /** A command prefix that sets credentials in the environment, such as `op run --env-file .env --`. */
  loadEnv?: string;
};

/** An outpost's `.factory/config.ts`. */
export type OutpostCliConfig = {
  /** The outpost's repo, as `owner/name`, when its git remote doesn't name it. */
  repo?: string;
  /** The ID of the hub's GitHub App for each GitHub connection that `.factory/infra.ts` uses, by connection name. */
  githubApps?: Record<string, number>;
};

/** Reads the default export of the config file at `file`, if there is one. */
export const loadConfig = async <T>(file: string): Promise<T> => {
  if (!existsSync(file)) return {} as T;
  return ((await import(pathToFileURL(file).href)).default ?? {}) as T;
};
