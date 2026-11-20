import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { appSlug } from "@notation/factory-github/app";
import { collectResourceGraph } from "@notation/resource";
import { loadConfig, openBrowser, type OutpostCliConfig, output } from "./shell.ts";

/** The repo's `owner/name`, from its `origin` remote on GitHub. */
const githubRepo = async (dir: string) => {
  const url = await output("git", ["remote", "get-url", "origin"], dir);
  const match = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!match) throw new Error(`The origin remote ${url} isn't on GitHub.`);
  return `${match[1]}/${match[2]}`;
};

/** The names of the GitHub connections that `.factory/infra.ts` uses. */
const githubConnections = async (infra: string) => {
  const graph = await collectResourceGraph(async () => {
    await import(pathToFileURL(infra).href);
  });
  return graph.resourceGroups
    .filter((group) => group.type === "github/ConnectionRef")
    .map((group) => (group.config as { name: string }).name);
};

const gh = async <T>(path: string) =>
  JSON.parse(await output("gh", ["api", path])) as T;

/** The outpost's directory: this one if it has `.factory/infra.ts`, otherwise the root of its git repo. */
const outpostDir = async () => {
  if (existsSync(join(process.cwd(), ".factory", "infra.ts"))) {
    return process.cwd();
  }
  const root = await output("git", ["rev-parse", "--show-toplevel"]);
  if (!existsSync(join(root, ".factory", "infra.ts"))) {
    throw new Error(`There's no .factory/infra.ts here or in ${root}.`);
  }
  return root;
};

/** The outpost's `.factory/config.ts`. */
const outpostConfig = (dir: string) => loadConfig<OutpostCliConfig>(join(dir, ".factory", "config.ts"));

/**
 * The outpost's repo: `given`, then `repo` in `.factory/config.ts`, then the
 * `origin` remote. The remote only names the outpost's repo when the outpost
 * is at the root of the git repo.
 */
const outpostRepo = async (dir: string, given?: string) => {
  const repo = given ?? (await outpostConfig(dir)).repo;
  if (repo) return repo;
  const root = await output("git", ["rev-parse", "--show-toplevel"], dir);
  if (realpathSync(root) !== realpathSync(dir)) {
    throw new Error(
      `${dir} isn't the root of its git repo, so its origin remote may be another repo's. Pass --repo <owner/name>, or set repo in .factory/config.ts.`,
    );
  }
  return githubRepo(dir);
};

/** The outcome of the repo's last deploy, which the hub writes to the repo's `FACTORY_STATUS` variable. */
type FactoryStatus = {
  state: "deployed" | "failed";
  ref?: string;
  error?: string;
  at: string;
};

/** The repo's `FACTORY_STATUS`, if the hub has written it. */
const readStatus = async (repo: string): Promise<FactoryStatus | undefined> => {
  try {
    return JSON.parse(await output("gh", ["variable", "get", "FACTORY_STATUS", "--repo", repo]));
  } catch {
    return undefined;
  }
};

/** Prints the status, and sets a failed exit code if the deploy failed. */
const report = (repo: string, status: FactoryStatus) => {
  const from = status.ref ? ` from ${status.ref.slice(0, 7)}` : "";
  if (status.state === "deployed") {
    console.log(`${repo}'s outpost is deployed${from}.`);
    return;
  }
  console.log(`${repo}'s outpost failed to deploy${from}:\n${status.error ?? "no reason given"}`);
  process.exitCode = 1;
};

const POLL_MS = 3000;
const WAIT_MS = 120_000;

/** Waits for a status written after `since`. */
const waitForStatus = async (repo: string, since: Date) => {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const status = await readStatus(repo);
    if (status && new Date(status.at) > since) return status;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return undefined;
};

/** Prints the outpost's `FACTORY_STATUS`. */
export const repoStatus = async ({ repo: given }: { repo?: string }) => {
  const repo = await outpostRepo(await outpostDir(), given);
  const status = await readStatus(repo);
  if (!status) {
    console.log(`The hub hasn't deployed ${repo}. Run \`factory repo install\` in it.`);
    return;
  }
  report(repo, status);
};

/**
 * Installs the outpost's repo on the hub:
 * 1. Opens GitHub's page to install each connection's App on the repo.
 * 2. Waits for the hub to deploy the repo's outpost, which GitHub's install
 *    event starts, and prints the outcome.
 */
export const repoInstall = async ({ repo: given }: { repo?: string }) => {
  const dir = await outpostDir();
  const repo = await outpostRepo(dir, given);
  const since = new Date();
  const names = await githubConnections(join(dir, ".factory", "infra.ts"));
  if (names.length === 0) {
    console.log(".factory/infra.ts uses no GitHub connection, so there's nothing to install.");
    return;
  }
  const { githubApps = {} } = await outpostConfig(dir);
  const missing = names.filter((name) => githubApps[name] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Set githubApps in .factory/config.ts to the ID of the hub's GitHub App for each connection, such as githubApps: { ${missing.map((name) => `${name}: 123456`).join(", ")} }. The App's ID is on its settings page, and \`factory infra up\` prints it when it creates the App.`,
    );
  }
  const { id: repoId, owner } = await gh<{ id: number; owner: { id: number } }>(`repos/${repo}`);

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  // readline takes Ctrl+C from the process while it's open, and without this listener only pauses.
  prompt.on("SIGINT", () => process.exit(130));
  try {
    for (const name of names) {
      const slug = await appSlug(String(githubApps[name]));
      const url = `https://github.com/apps/${slug}/installations/new/permissions?suggested_target_id=${owner.id}&repository_ids[]=${repoId}`;
      console.log(`Install the GitHub App ${slug} on ${repo}:\n  ${url}`);
      openBrowser(url);
      await prompt.question("Press Enter when it's installed. ");
    }
  } finally {
    prompt.close();
  }
  console.log(`\nWaiting for the hub to deploy ${repo}…`);
  const status = await waitForStatus(repo, since);
  if (status) return report(repo, status);
  console.log(
    `The hub hasn't deployed ${repo} yet. GitHub only tells the hub about a new install. If the App was already installed on ${repo}, push to .factory/ on the default branch to deploy it, then run \`factory repo status\`.`,
  );
};
