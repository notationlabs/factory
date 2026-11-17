import type { DeployerContext, Program } from "@notation/factory/deployer";
import type { WorkerLoader } from "./types.ts";

const COMPATIBILITY_DATE = "2026-10-12";

/** The module that the loader starts: it calls the program's main function with the request's JSON body, and answers with its result or its error. */
const HOST = "factory-host.js";

const hostModule = (main: string) =>
  [
    `import run from "./${main}";`,
    `export default {`,
    `  async fetch(request) {`,
    `    try {`,
    `      return Response.json({ ok: true, value: await run(await request.json()) });`,
    `    } catch (error) {`,
    `      return Response.json({ ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) });`,
    `    }`,
    `  },`,
    `};`,
  ].join("\n");

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * Runs programs with the Worker Loader. The loader keeps an isolate for each
 * id. An isolate imports a config's modules once, and a config declares its
 * resources only when it's imported, so each call gets an id of its own.
 */
export const loaderContext = (
  loader: WorkerLoader,
): Pick<DeployerContext, "evaluate"> => ({
  async evaluate(program: Program) {
    const modules: Record<string, { js: string }> = {
      [HOST]: { js: hostModule(program.main) },
    };
    for (const [name, js] of Object.entries(program.modules)) modules[name] = { js };
    const id = `${await sha256(JSON.stringify({ main: program.main, modules: program.modules }))}:${crypto.randomUUID()}`;
    const worker = loader.get(id, () => ({
      compatibilityDate: COMPATIBILITY_DATE,
      compatibilityFlags: ["nodejs_compat"],
      mainModule: HOST,
      modules,
      globalOutbound: null,
      env: {},
    }));
    const response = await worker
      .getEntrypoint()
      .fetch(new Request("http://outpost/", { method: "POST", body: JSON.stringify(program.input ?? null) }));
    const result = (await response.json()) as
      | { ok: true; value: unknown }
      | { ok: false; error: string };
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
});
