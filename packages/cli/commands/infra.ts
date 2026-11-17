import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, shell } from "./shell.ts";

const hubDir = () => {
  const dir = process.cwd();
  if (!existsSync(join(dir, "factory.infra.ts"))) {
    throw new Error(`There's no factory.infra.ts in ${dir}. Run this in the hub's repo.`);
  }
  return dir;
};

const notation = async (args: string) => {
  const dir = hubDir();
  const { loadEnv } = await loadConfig(dir);
  await shell(`${loadEnv ? `${loadEnv} ` : ""}npx notation ${args} --pretty`, dir);
};

/** Deploys the hub. Deploy also syncs each connection with the router. */
export const infraUp = async ({ dryRun }: { dryRun: boolean }) => {
  await notation(dryRun ? "plan" : "deploy");
  if (!dryRun) {
    console.log("\nThe hub is up. To serve a repo, run `factory repo install` in it.");
  }
};

export const infraDown = async () => {
  await notation("destroy");
};
