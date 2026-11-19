import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DeliveriesResult, ReplayResult, ReposResult, SyncResult } from "@notation/factory/router";
import { admin } from "./operator.ts";
import { type HubConfig, loadConfig, shell } from "./shell.ts";

const hubDir = () => {
  const dir = process.cwd();
  if (!existsSync(join(dir, "factory.infra.ts"))) {
    throw new Error(`There's no factory.infra.ts in ${dir}. Run this in the hub's repo.`);
  }
  return dir;
};

const hubConfig = (dir: string) => loadConfig<HubConfig>(join(dir, "factory.config.ts"));

const NO_ROUTER = "Set router in factory.config.ts to the router's URL. `factory infra up` prints it when it creates the router.";

/** The URL of the hub's router, from `factory.config.ts`. */
const routerUrl = async () => {
  const { router } = await hubConfig(hubDir());
  if (!router) throw new Error(NO_ROUTER);
  return router;
};

const quote = (arg: string) => `'${arg.replace(/'/g, `'\\''`)}'`;

// The packages ship TypeScript, which Node won't strip from files under
// node_modules, so Notation runs on bun.
const notation = async (args: string) => {
  const dir = hubDir();
  const { loadEnv } = await hubConfig(dir);
  await shell(`${loadEnv ? `${loadEnv} ` : ""}bun x --bun notation ${args} --pretty`, dir);
};

/**
 * Deploys the hub, which also syncs each connection with the router. Then
 * asks the router to deploy every repo again, and doesn't wait for the
 * deploys. Each of `credentials` is passed to Notation as `--credential`.
 */
export const infraUp = async ({ dryRun, credentials = [] }: { dryRun: boolean; credentials?: string[] }) => {
  const flags = credentials.map((c) => ` --credential ${quote(c)}`).join("");
  await notation(`${dryRun ? "plan" : "deploy"}${flags}`);
  if (dryRun) return;
  console.log("\nThe hub is up. To serve a repo, run `factory repo install` in it.");
  const { router } = await hubConfig(hubDir());
  if (!router) {
    console.log(`The hub's repos weren't deployed again. ${NO_ROUTER}`);
    return;
  }
  const { deploying, removing } = await admin<SyncResult>(router, "POST", "/admin/sync");
  if (deploying.length) console.log(`The hub is deploying ${deploying.join(", ")} again.`);
  if (removing.length) console.log(`The hub is removing the outposts of ${removing.join(", ")}, which it can no longer read.`);
  if (deploying.length || removing.length) console.log("Run `factory infra status` to see how the deploys went.");
};

export const infraDown = async () => {
  await notation("destroy");
};

const short = (ref?: string) => (ref ? ref.slice(0, 7) : undefined);

/** Prints each repo's last deploy and its containers' builds, then the failed deliveries. */
export const infraStatus = async () => {
  const router = await routerUrl();
  const repos = await admin<ReposResult>(router, "GET", "/admin/repos");
  const deliveries = await admin<DeliveriesResult>(router, "GET", "/admin/deliveries");
  if (!repos.repos.length) console.log("The hub has deployed no repos.");
  for (const { repo, status, builds } of repos.repos) {
    const from = status.ref ? ` from ${short(status.ref)}` : "";
    console.log(`${repo}: ${status.state}${from} at ${status.at}`);
    if (status.error) console.log(`  ${status.error.split("\n").join("\n  ")}`);
    for (const [container, build] of Object.entries(builds)) {
      console.log(`  ${container}: build ${build.state} at ${short(build.ref)}${build.url ? ` ${build.url}` : ""}`);
    }
  }
  if (!deliveries.failed.length) {
    console.log("\nNo deliveries failed in the last 7 days.");
    return;
  }
  console.log("\nFailed deliveries:");
  for (const d of deliveries.failed) {
    console.log(`  ${d.connection}/${d.id}: ${d.event} on ${d.repo}, received ${new Date(d.received).toISOString()}`);
    for (const t of d.triggers) console.log(`    ${t.trigger}: ${t.error ?? "no reason given"}`);
  }
  console.log("\nRun `factory infra replay` to start them again, or `factory infra replay <delivery>` for one.");
};

/** Replays one failed delivery, named as `<connection>/<id>` like `factory infra status` lists it, or all of them. */
export const infraReplay = async ({ delivery }: { delivery?: string }) => {
  const router = await routerUrl();
  let body: { connection: string; id: string } | undefined;
  if (delivery) {
    const slash = delivery.lastIndexOf("/");
    if (slash <= 0) throw new Error(`${delivery} isn't a delivery. Name it as \`factory infra status\` lists it, such as github/gh/<id>.`);
    body = { connection: delivery.slice(0, slash), id: delivery.slice(slash + 1) };
  }
  const { replayed, skipped } = await admin<ReplayResult>(router, "POST", "/admin/replay", body ?? {});
  for (const d of replayed) console.log(`Replaying ${d.connection}/${d.id}.`);
  for (const d of skipped) console.log(`${d.connection}/${d.id} is no longer a failed delivery, so it wasn't replayed.`);
  if (!replayed.length && !skipped.length) console.log("No deliveries failed in the last 7 days.");
  if (skipped.length && delivery) process.exitCode = 1;
};
