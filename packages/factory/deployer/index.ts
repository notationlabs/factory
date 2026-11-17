import { transform } from "sucrase";
import type { OutpostConfig } from "../contracts/outpost.ts";
import type { FactoryStatus, SourceFiles } from "../router/channel.ts";
import { FACTORY_DIR } from "../router/handle.ts";
import sdk from "./sdk.gen.ts";
import { SDK_COLLECT, SDK_DIR, SDK_PACKAGES } from "./sdk.ts";

/**
 * ES modules by name, all JavaScript. `main` default-exports a function
 * that returns the result.
 */
export type Program = { main: string; modules: Record<string, string> };

/** What the deployer needs from the platform it runs on. */
export interface DeployerContext {
  /**
   * Runs `program` in an isolate with no network access and no bindings, and
   * returns what its main function returns. Throws the program's error.
   */
  evaluate(program: Program): Promise<unknown>;
  /** Stores the repo's outpost config, where the router reads it. */
  putOutpost(repo: string, outpost: OutpostConfig): Promise<void>;
  deleteOutpost(repo: string): Promise<void>;
}

const MAIN = "main.js";

/**
 * The program that runs an outpost's config:
 * 1. Each `.ts` file in `.factory/` loses its types. Its name stays, so that
 *    the files' imports of each other still resolve.
 * 2. Each package that a config can import is a module of its own name, which
 *    re-exports the SDK's build of it. The SDK's modules are under `sdk/`.
 * 3. The main module runs `.factory/config.ts` through the SDK's collector.
 */
export const outpostProgram = (files: Record<string, string>): Program => {
  if (!(`config.ts` in files)) throw new Error(`There's no ${FACTORY_DIR}/config.ts.`);
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
  modules[MAIN] = [
    `import { collectOutpost } from "./${SDK_DIR}/${SDK_COLLECT}.js";`,
    `export default () => collectOutpost(() => import("./${FACTORY_DIR}/config.ts"));`,
  ].join("\n");
  return { main: MAIN, modules };
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
 * `.factory/config.ts` loses its outpost. A config that fails leaves the
 * outpost as it was.
 */
export const deploy = async (
  repo: string,
  { ref, files }: SourceFiles,
  context: DeployerContext,
): Promise<FactoryStatus> => {
  if (!("config.ts" in files)) {
    await context.deleteOutpost(repo);
    return { state: "failed", ref, error: `There's no ${FACTORY_DIR}/config.ts.`, at: new Date().toISOString() };
  }
  try {
    await context.putOutpost(repo, await evaluateOutpost(repo, files, context));
    return { state: "deployed", ref, at: new Date().toISOString() };
  } catch (error) {
    return { state: "failed", ref, error: message(error), at: new Date().toISOString() };
  }
};
