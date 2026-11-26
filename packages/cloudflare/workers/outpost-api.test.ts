import assert from "node:assert/strict";
import { test } from "node:test";
import { instanceName, isCapacityError, within } from "./outpost-api.ts";

const conversation = { id: "acme/api#127" };

test("runs in a branch worktree go to that worktree's container", () => {
  assert.equal(instanceName({ conversation, worktree: { branch: "issue-127" } }), "worktree:issue-127");
  assert.equal(
    instanceName({ conversation: { id: "acme/api#200" }, worktree: { branch: "issue-127", base: "main" } }),
    "worktree:issue-127",
  );
});

test("runs in a scratch worktree go to their conversation's container", () => {
  assert.equal(instanceName({ conversation }), "scratch:acme/api#127");
});

test("Cloudflare's errors for no free instance are capacity errors, and others aren't", () => {
  assert.ok(isCapacityError(new Error("There is no Container instance that can be provided to this Durable Object")));
  assert.ok(isCapacityError(new Error("You are requesting too many containers per second")));
  assert.ok(!isCapacityError(new Error("The runner refused the run with status 500: boom")));
});

test("a handoff that hangs fails once its deadline passes, and one that answers in time resolves", async () => {
  await assert.rejects(within(new Promise(() => {}), 10, "The runner didn't answer."), /The runner didn't answer\./);
  assert.equal(await within(Promise.resolve(202), 10, "late"), 202);
});
