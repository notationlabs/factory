import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { collectResourceGraph } from "@notation/resource";
import { openBrowser, output } from "./shell.ts";

/** The repo's `owner/name`, from its `origin` remote on GitHub. */
const githubRepo = async (dir: string) => {
  const url = await output("git", ["remote", "get-url", "origin"], dir);
  const match = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!match) throw new Error(`The origin remote ${url} isn't on GitHub.`);
  return `${match[1]}/${match[2]}`;
};

/** The names of the GitHub connections that `.factory/config.ts` uses. */
const githubConnections = async (config: string) => {
  const graph = await collectResourceGraph(async () => {
    await import(pathToFileURL(config).href);
  });
  return graph.resourceGroups
    .filter((group) => group.type === "github/ConnectionRef")
    .map((group) => (group.config as { name: string }).name);
};

/** The slug GitHub gives an App with this name. */
const appSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const gh = async <T>(path: string) =>
  JSON.parse(await output("gh", ["api", path])) as T;

/** The outpost's `.factory/config.ts`, in this directory or at the root of its git repo. */
const outpostConfig = async () => {
  const here = join(process.cwd(), ".factory", "config.ts");
  if (existsSync(here)) return here;
  const root = await output("git", ["rev-parse", "--show-toplevel"]);
  const config = join(root, ".factory", "config.ts");
  if (!existsSync(config)) {
    throw new Error(`There's no .factory/config.ts here or in ${root}.`);
  }
  return config;
};

/**
 * Opens GitHub's page to install each connection's App on the repo: `repo`
 * if given, otherwise the repo of the `origin` remote.
 */
export const repoInstall = async ({ repo: given }: { repo?: string }) => {
  const config = await outpostConfig();
  const repo = given ?? (await githubRepo(process.cwd()));
  const names = await githubConnections(config);
  if (names.length === 0) {
    console.log(".factory/config.ts uses no GitHub connection, so there's nothing to install.");
    return;
  }
  const { id: repoId, owner } = await gh<{ id: number; owner: { id: number } }>(`repos/${repo}`);

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const name of names) {
      const slug = appSlug(name);
      await gh(`apps/${slug}`).catch(() => {
        throw new Error(`There's no GitHub App ${slug}. Run \`factory infra up\` in the hub's repo first.`);
      });
      const url = `https://github.com/apps/${slug}/installations/new/permissions?target_id=${owner.id}&repository_ids[]=${repoId}`;
      console.log(`Install the GitHub App ${slug} on ${repo}:\n  ${url}`);
      openBrowser(url);
      await prompt.question("Press Enter when it's installed. ");
    }
  } finally {
    prompt.close();
  }
  console.log(`\n${repo} is installed. GitHub now sends its events to the hub.`);
};
