import { transform } from "sucrase";
import type { OutpostConfig } from "../contracts/outpost.ts";
import type { FactoryStatus, SourceFiles } from "../router/channel.ts";
import { FACTORY_DIR } from "../router/handle.ts";
import sdk from "./sdk.gen.ts";
import { SDK_COLLECT, SDK_DIR, SDK_PACKAGES } from "./sdk.ts";

/**
 * ES modules by name, all JavaScript. `main` default-exports a function
 * that takes `input` and returns the result. `input` is JSON.
 */
export type Program = { main: string; modules: Record<string, string>; input?: unknown };

/** What the deployer needs from the platform it runs on. */
export interface DeployerContext {
  /**
   * Runs `program` in an isolate with no network access and no bindings,
   * calls its main function with `program.input`, and returns what it
   * returns. Throws the program's error.
   */
  evaluate(program: Program): Promise<unknown>;
  /**
   * Stores the repo's outpost config, where the router reads it, and the
   * `.factory/` files it was evaluated from. `ref` is the commit they were
   * read at, and `executables` are the paths of the files that are
   * executable. Resolves to the containers whose images started building.
   */
  putOutpost(
    repo: string,
    outpost: OutpostConfig,
    files: Record<string, string>,
    ref: string,
    executables?: string[],
  ): Promise<string[]>;
  /** The `.factory/` files of the repo's outpost. */
  getFiles(repo: string): Promise<Record<string, string> | undefined>;
  deleteOutpost(repo: string): Promise<void>;
}

const MAIN = "main.js";

/**
 * The modules of an outpost's config:
 * 1. Each `.ts` file in `.factory/` loses its types. Its name stays, so that
 *    the files' imports of each other still resolve.
 * 2. Each package that a config can import is a module of its own name, which
 *    re-exports the SDK's build of it. The SDK's modules are under `sdk/`.
 */
const configModules = (files: Record<string, string>) => {
  if (!(`infra.ts` in files)) throw new Error(`There's no ${FACTORY_DIR}/infra.ts.`);
  const modules: Record<string, string> = {};
  for (const [path, code] of Object.entries(files)) {
    if (/\.(m?js)$/.test(path)) modules[`${FACTORY_DIR}/${path}`] = code;
    if (/\.(m?ts)$/.test(path)) {
      modules[`${FACTORY_DIR}/${path}`] = transform(code, {
        transforms: ["typescript"],
        disableESTransforms: true,
        filePath: path,
      }).code;
    }
  }
  for (const [file, code] of Object.entries(sdk)) modules[`${SDK_DIR}/${file}`] = code;
  // The runtime resolves a package's name relative to the importing module,
  // like a relative path, so each directory of files gets its own aliases.
  const dirs = new Set(
    Object.keys(modules)
      .filter((name) => name.startsWith(`${FACTORY_DIR}/`))
      .map((name) => name.slice(0, name.lastIndexOf("/"))),
  );
  for (const dir of dirs) {
    for (const [name, module] of Object.entries(SDK_PACKAGES)) {
      const alias = `${dir}/${name}`;
      const up = "../".repeat(alias.split("/").length - 1);
      modules[alias] = `export * from "${up}${SDK_DIR}/${module}.js";`;
    }
  }
  return modules;
};

/** The program that runs an outpost's config through the SDK's collector, and returns the outpost config. */
export const outpostProgram = (files: Record<string, string>): Program => {
  const modules = configModules(files);
  modules[MAIN] = [
    `import { collectOutpost } from "./${SDK_DIR}/${SDK_COLLECT}.js";`,
    `export default () => collectOutpost(() => import("./${FACTORY_DIR}/infra.ts"));`,
  ].join("\n");
  return { main: MAIN, modules };
};

/** The program that runs an outpost's config, and calls the worktree function of `trigger` with its input. */
export const worktreeProgram = (files: Record<string, string>, trigger: string, payload: unknown): Program => {
  const modules = configModules(files);
  modules[MAIN] = [
    `import { collectWorktree } from "./${SDK_DIR}/${SDK_COLLECT}.js";`,
    `export default (payload) => collectWorktree(() => import("./${FACTORY_DIR}/infra.ts"), ${JSON.stringify(trigger)}, payload);`,
  ].join("\n");
  return { main: MAIN, modules, input: payload };
};

/**
 * Calls the worktree function of the repo's trigger with `payload`, and
 * returns the branch it names. The config is the one the outpost was last
 * deployed from.
 */
export const worktree = async (
  repo: string,
  trigger: string,
  payload: unknown,
  context: Pick<DeployerContext, "evaluate" | "getFiles">,
): Promise<string | undefined> => {
  const files = await context.getFiles(repo);
  if (!files) throw new Error(`${repo} has no deployed outpost.`);
  const branch = await context.evaluate(worktreeProgram(files, trigger, payload));
  if (branch === undefined || branch === null) return undefined;
  if (typeof branch !== "string") {
    throw new Error(`The worktree function of ${trigger} returned ${typeof branch}, not a string.`);
  }
  return branch;
};

/**
 * Evaluates a repo's `.factory/` files, and returns the repo's outpost
 * config. A channel with no scope gets the repo's.
 */
export const evaluateOutpost = async (
  repo: string,
  files: Record<string, string>,
  context: Pick<DeployerContext, "evaluate">,
): Promise<OutpostConfig> => {
  const outpost = (await context.evaluate(outpostProgram(files))) as OutpostConfig;
  for (const channel of Object.values(outpost.channels ?? {})) {
    channel.scope ??= repo;
  }
  return outpost;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Deploys a repo's outpost from its `.factory/` files. A repo with no
 * `.factory/infra.ts` loses its outpost. A config that fails leaves the
 * outpost as it was.
 */
export const deploy = async (
  repo: string,
  { ref, files, executables }: SourceFiles,
  context: DeployerContext,
): Promise<FactoryStatus> => {
  if (!("infra.ts" in files)) {
    await context.deleteOutpost(repo);
    return { state: "failed", ref, error: `There's no ${FACTORY_DIR}/infra.ts.`, at: new Date().toISOString() };
  }
  try {
    const builds = await context.putOutpost(repo, await evaluateOutpost(repo, files, context), files, ref, executables);
    return { state: "deployed", ref, at: new Date().toISOString(), ...(builds.length && { builds }) };
  } catch (error) {
    return { state: "failed", ref, error: message(error), at: new Date().toISOString() };
  }
};
