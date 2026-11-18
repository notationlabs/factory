import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
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

export type FactoryConfig = {
  /** A command prefix that sets credentials in the environment, such as `op run --env-file .env --`. */
  loadEnv?: string;
  /** An outpost's repo, as `owner/name`, when its git remote doesn't name it. */
  repo?: string;
  /** The hub an outpost subscribes to: its Notation app and stage, which name the hub's GitHub Apps. */
  hub?: { app: string; stage: string };
};

/** Reads `factory.config.ts` in `dir`, if there is one. */
export const loadConfig = async (dir: string): Promise<FactoryConfig> => {
  const file = join(dir, "factory.config.ts");
  if (!existsSync(file)) return {};
  return ((await import(pathToFileURL(file).href)).default ?? {}) as FactoryConfig;
};
