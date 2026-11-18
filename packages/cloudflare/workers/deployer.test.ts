import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { unstable_startWorker } from "wrangler";

const outpostDir = join(import.meta.dirname, "../../../examples/outpost-1/.factory");
const REPO = "djgrant/notation-factory-test-outpost-1";

let worker: Awaited<ReturnType<typeof unstable_startWorker>>;

before(async () => {
  worker = await unstable_startWorker({
    config: join(import.meta.dirname, "test/wrangler.jsonc"),
    dev: { server: { port: 0 }, inspector: false, logLevel: "error" },
  });
  await worker.ready;
});

after(() => worker?.dispose());

const evaluate = async (files: Record<string, string>) => {
  const response = await worker.fetch("http://deployer/", {
    method: "POST",
    body: JSON.stringify({ repo: REPO, files }),
  });
  return (await response.json()) as { outpost?: any; error?: string };
};

const exampleFiles = () =>
  Object.fromEntries(
    readdirSync(outpostDir)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => [file, readFileSync(join(outpostDir, file), "utf8")]),
  );

test("evaluates an outpost's config in a loaded Worker", async () => {
  const { outpost, error } = await evaluate(exampleFiles());
  assert.equal(error, undefined);
  assert.deepEqual(outpost.channels.issues, {
    provider: "github",
    connection: "gh",
    scope: REPO,
  });
  assert.deepEqual(outpost.containers.dev.runtimes, ["claude", "droid"]);
  assert.equal(outpost.agents["droid-coder"]?.runtime, "droid");
  assert.equal(outpost.triggers["droid-mention"]?.agent, "droid-coder");
  assert.equal(outpost.agents.coder.runtime, "claude");
  assert.equal(outpost.triggers.mention.event, "issue_comment");
  assert.equal(outpost.triggers.mention.agent, "coder");
});

test("resolves imports between the config's own files", async () => {
  const { outpost, error } = await evaluate({
    "config.ts": `import { Policy } from "@notation/factory-github";\nimport { id } from "./lib/ids.ts";\nnew Policy(id, { permissions: { contents: "read" } });`,
    "lib/ids.ts": `export const id: string = "read";`,
  });
  assert.equal(error, undefined);
  assert.equal(outpost.policies.read.provider, "github");
});

test("returns the config's error", async () => {
  const { error } = await evaluate({ "config.ts": `throw new Error("bad config");` });
  assert.match(error!, /bad config/);
});

test("gives the config no network", async () => {
  const { error } = await evaluate({
    "config.ts": `await fetch("https://example.com");`,
  });
  assert.ok(error);
});

test("refuses a hub-only export", async () => {
  const { error } = await evaluate({
    "config.ts": `import { RandomKey } from "@notation/factory";\nnew RandomKey("k", { config: {} });`,
  });
  assert.match(error!, /RandomKey/);
});

const branch = async (trigger: string, payload: unknown) => {
  const response = await worker.fetch("http://deployer/", {
    method: "POST",
    body: JSON.stringify({ repo: REPO, files: exampleFiles(), trigger, payload }),
  });
  return (await response.json()) as { branch?: string | null; error?: string };
};

test("calls a trigger's worktree function with the event, as often as it's asked", async () => {
  assert.deepEqual(await branch("mention", { issue: { number: 5 } }), { branch: "issue-5" });
  assert.deepEqual(await branch("mention", { issue: { number: 6 } }), { branch: "issue-6" });
});

test("a trigger the config doesn't declare is an error", async () => {
  const { error } = await branch("missing", {});
  assert.match(error!, /no trigger missing/);
});
