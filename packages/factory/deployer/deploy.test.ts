import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutpostConfig } from "../contracts/outpost.ts";
import { type DeployerContext, deploy } from "./index.ts";

const previous: OutpostConfig = { channels: {}, containers: {}, policies: {}, agents: {}, triggers: {} };

const context = (evaluate: DeployerContext["evaluate"]) => {
  const stored: Record<string, OutpostConfig | undefined> = { "acme/api": previous };
  const ctx: DeployerContext = {
    evaluate,
    putOutpost: async (repo, outpost) => {
      stored[repo] = outpost;
      return [];
    },
    getFiles: async () => undefined,
    deleteOutpost: async (repo) => void delete stored[repo],
  };
  return { ctx, stored };
};

test("deploy stores the evaluated outpost, with the repo as the scope of unscoped channels", async () => {
  const { ctx, stored } = context(async () => ({
    channels: { issues: { provider: "github", connection: "gh" } },
  }));
  const status = await deploy("acme/api", { ref: "abc", files: { "config.ts": "" } }, ctx);
  assert.equal(status.state, "deployed");
  assert.equal(status.ref, "abc");
  assert.deepEqual(stored["acme/api"], {
    channels: { issues: { provider: "github", connection: "gh", scope: "acme/api" } },
  });
});

test("a config that fails leaves the outpost as it was", async () => {
  const { ctx, stored } = context(async () => {
    throw new Error("bad config");
  });
  const status = await deploy("acme/api", { ref: "abc", files: { "config.ts": "" } }, ctx);
  assert.equal(status.state, "failed");
  assert.equal(status.error, "bad config");
  assert.equal(stored["acme/api"], previous);
});

test("a repo with no config.ts loses its outpost", async () => {
  const { ctx, stored } = context(async () => ({}));
  const status = await deploy("acme/api", { ref: "abc", files: { Dockerfile: "" } }, ctx);
  assert.equal(status.state, "failed");
  assert.match(status.error!, /no \.factory\/config\.ts/);
  assert.equal("acme/api" in stored, false);
});
