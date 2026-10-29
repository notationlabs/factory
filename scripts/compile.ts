/**
 * Evaluates each example and writes what it collects: its groups, and its
 * concrete resources with their params as they'd be planned. Outputs that
 * only exist after deploy show as `<resource-id.field>`.
 *
 *   tsx scripts/compile.ts          writes dist/<example>.json
 *   tsx scripts/compile.ts --view   also writes dist/index.html and opens it
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type BaseResource,
  isOutputValue,
  type ResourceGraph,
  ResourceGroup,
} from "@notation/resource";
import { renderHtml } from "./viewer.ts";

const root = resolve(import.meta.dirname, "..");
const examplesDir = join(root, "examples");
const outDir = join(root, "dist");
const OUTPOST_REPO = "acme/webapp";

export type CompiledResource = {
  id: string;
  type: string;
  /** The group the resource was added to, if any. */
  group: { type: string; id: string } | null;
  dependsOn: string[];
  params: unknown;
};

export type CompiledExample = {
  name: string;
  kind: "hub" | "outpost";
  repo?: string;
  groups: {
    type: string;
    id: string;
    config: unknown;
  }[];
  resources: CompiledResource[];
  error?: string;
};

const isResource = (value: unknown): value is BaseResource =>
  typeof value === "object" &&
  value !== null &&
  "schema" in value &&
  "contributions" in value;

const isGroup = (value: unknown): value is ResourceGroup =>
  value instanceof ResourceGroup;

/** JSON-safe: resources and groups become their ids, functions are marked, output values become placeholders. */
const plain = (value: unknown): unknown => {
  if (isOutputValue(value))
    return `<${value.resource.id}.${value.path.join(".")}>`;
  if (isResource(value)) return `<resource ${value.id}>`;
  if (isGroup(value)) return `<group ${value.type} ${value.id}>`;
  if (typeof value === "function")
    return `<function ${value.name || "anonymous"}>`;
  if (typeof value === "symbol" || typeof value === "bigint")
    return String(value);
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, plain(v)]),
    );
  return value;
};

/** Nothing's deployed, so each resource's outputs read as placeholders naming the output. */
const stubOutputs = (resources: BaseResource[]) => {
  for (const resource of resources)
    resource.setOutput(
      new Proxy(
        {},
        {
          get: (_, key) =>
            typeof key === "string" ? `<${resource.id}.${key}>` : undefined,
        },
      ),
    );
};

const compileGraph = async (graph: ResourceGraph) => {
  stubOutputs(graph.resources);
  const resources: CompiledResource[] = [];
  for (const resource of graph.resources) {
    let params: unknown;
    try {
      params = plain(await resource.getParams());
    } catch (error) {
      params = {
        $error: error instanceof Error ? error.message : String(error),
      };
    }
    resources.push({
      id: resource.id,
      type: resource.type,
      group: resource.group,
      dependsOn: [
        ...new Set(
          Object.values(resource.dependencies)
            .filter((d): d is BaseResource => !!d)
            .map((d) => d.id),
        ),
      ],
      params,
    });
  }
  const groups = graph.resourceGroups.map((g) => ({
    type: g.type,
    id: g.id,
    config: plain(g.config),
  }));
  return { groups, resources };
};

const compileExample = async (file: string): Promise<CompiledExample> => {
  const name = basename(file, ".ts");
  const mod = await import(pathToFileURL(file).href);
  const declared = mod.default as (repo?: string) => Promise<ResourceGraph>;
  // `outpost(…)` returns a function of the repo being deployed; `lightbox(…)` takes nothing.
  const kind = declared.length > 0 ? "outpost" : "hub";
  const repo = kind === "outpost" ? OUTPOST_REPO : undefined;
  try {
    const graph = await declared(repo);
    return { name, kind, repo, ...(await compileGraph(graph)) };
  } catch (error) {
    return {
      name,
      kind,
      repo,
      groups: [],
      resources: [],
      error:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    };
  }
};

const open = (path: string) => {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer"
        : "xdg-open";
  execFile(cmd, [path], (error) => {
    if (error) console.error(`Couldn't open ${path}: ${error.message}`);
  });
};

const files = (await readdir(examplesDir))
  .filter((f) => f.endsWith(".ts"))
  .sort()
  .map((f) => join(examplesDir, f));

// One at a time: only one resource graph can be collected at once.
const compiled: CompiledExample[] = [];
for (const file of files) compiled.push(await compileExample(file));

await mkdir(outDir, { recursive: true });
for (const example of compiled) {
  const path = join(outDir, `${example.name}.json`);
  await writeFile(path, `${JSON.stringify(example, null, 2)}\n`);
  const summary = example.error
    ? `failed: ${example.error.split("\n")[0]}`
    : `${example.resources.length} resources`;
  console.log(`${path.slice(root.length + 1)}  ${summary}`);
}

if (process.argv.includes("--view")) {
  const path = join(outDir, "index.html");
  await writeFile(path, renderHtml(compiled));
  console.log(path.slice(root.length + 1));
  open(path);
}

if (compiled.some((e) => e.error)) process.exitCode = 1;
