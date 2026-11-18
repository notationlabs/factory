#!/usr/bin/env node
import { infraDown, infraUp } from "../commands/infra.ts";
import { repoInstall, repoStatus } from "../commands/repo.ts";

const usage = `Usage:
  factory infra up [--dry-run]   deploy the hub in this directory
  factory infra down             destroy the hub in this directory
  factory repo install [--repo <owner/name>] [--app <slug>]
                                 install the hub's GitHub App on this repo,
                                 and wait for its outpost to deploy
  factory repo status [--repo <owner/name>]
                                 show how this repo's last deploy went`;

const flag = (args: string[], name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const [group, command, ...args] = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const repo = flag(args, "--repo");
const app = flag(args, "--app");

const run = async () => {
  if (group === "infra" && command === "up") return infraUp({ dryRun });
  if (group === "infra" && command === "down") return infraDown();
  if (group === "repo" && command === "install") return repoInstall({ repo, app });
  if (group === "repo" && command === "status") return repoStatus({ repo });
  console.error(usage);
  process.exitCode = 1;
};

try {
  await run();
} catch (error) {
  console.error(`factory: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
