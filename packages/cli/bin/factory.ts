#!/usr/bin/env bun
import { infraDown, infraReplay, infraStatus, infraUp } from "../commands/infra.ts";
import { repoInstall, repoStatus } from "../commands/repo.ts";

const usage = `Usage:
  factory infra up [--dry-run] [--credential <id>.<credential>@<hash>=<var>]
                                 deploy the hub in this directory, and have
                                 it deploy its repos again
  factory infra status           show each repo's last deploy, and the
                                 failed deliveries
  factory infra replay [<delivery>]
                                 start the failed deliveries' runs again
  factory infra down             destroy the hub in this directory
  factory repo install [--repo <owner/name>]
                                 install the hub's GitHub Apps on this repo,
                                 and wait for its outpost to deploy
  factory repo status [--repo <owner/name>]
                                 show how this repo's last deploy went`;

const flag = (args: string[], name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const flags = (args: string[], name: string) => args.flatMap((arg, i) => (arg === name && args[i + 1] ? [args[i + 1]!] : []));

const [group, command, ...args] = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const repo = flag(args, "--repo");

const run = async () => {
  if (group === "infra" && command === "up") return infraUp({ dryRun, credentials: flags(args, "--credential") });
  if (group === "infra" && command === "status") return infraStatus();
  if (group === "infra" && command === "replay") return infraReplay({ delivery: args.find((a) => !a.startsWith("--")) });
  if (group === "infra" && command === "down") return infraDown();
  if (group === "repo" && command === "install") return repoInstall({ repo });
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
