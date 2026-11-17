#!/usr/bin/env node
import { infraDown, infraUp } from "../commands/infra.ts";
import { repoInstall } from "../commands/repo.ts";

const usage = `Usage:
  factory infra up [--dry-run]   deploy the hub in this directory
  factory infra down             destroy the hub in this directory
  factory repo install [--repo <owner/name>]
                                 install the hub's connections on this repo`;

const [group, command, ...args] = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const repoFlag = args.indexOf("--repo");
const repo = repoFlag === -1 ? undefined : args[repoFlag + 1];

const run = async () => {
  if (group === "infra" && command === "up") return infraUp({ dryRun });
  if (group === "infra" && command === "down") return infraDown();
  if (group === "repo" && command === "install") return repoInstall({ repo });
  console.error(usage);
  process.exitCode = 1;
};

try {
  await run();
} catch (error) {
  console.error(`factory: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
