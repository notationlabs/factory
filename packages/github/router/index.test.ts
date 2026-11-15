import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutpostConfig, RouterConfig } from "@notation/factory/router";
import { connectionForApp, matchTriggers, verifySignature } from "./index.ts";

const encode = (s: string) => new TextEncoder().encode(s);

// The example in GitHub's "Validating webhook deliveries" docs.
test("verifySignature accepts GitHub's example and rejects a changed body", async () => {
  const secret = "It's a Secret to Everybody";
  const header =
    "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
  assert.equal(await verifySignature(secret, encode("Hello, World!"), header), true);
  assert.equal(await verifySignature(secret, encode("Hello, World?"), header), false);
  assert.equal(await verifySignature(secret, encode("Hello, World!"), null), false);
});

test("connectionForApp finds the GitHub connection by App id", () => {
  const config = {
    connections: {
      "slack/acme-agents": { provider: "slack", source: "123", credentials: {} },
      "github/acme-agents": { provider: "github", source: "123", credentials: {} },
    },
  } as unknown as RouterConfig;
  assert.equal(connectionForApp(config, "123"), "acme-agents");
  assert.equal(connectionForApp(config, "456"), undefined);
});

const outpost: OutpostConfig = {
  channels: {
    gh: { provider: "github", connection: "acme-agents" },
    docs: { provider: "github", connection: "acme-agents", scope: "acme/docs" },
  },
  containers: {},
  policies: {},
  agents: {},
  triggers: {
    "on-open": {
      channel: "gh",
      event: "issues",
      match: { actions: ["opened"], labels: ["bug"], from: { kind: "collaborators" } },
      agent: "triage",
      container: "dev",
    },
    "on-mention": {
      channel: "gh",
      event: "issue_comment",
      match: {
        actions: ["created", "edited"],
        mention: "@claude",
        from: [{ kind: "user", login: "alice" }],
      },
      agent: "coder",
      container: "dev",
    },
    "docs-mention": {
      channel: "docs",
      event: "issue_comment",
      match: { actions: ["created"], mention: "@claude", from: { kind: "user", login: "alice" } },
      agent: "coder",
      container: "dev",
    },
  },
};

const delivery = (event: string, payload: object, repo = "acme/api") => ({
  connection: "acme-agents",
  repo: "acme/api",
  event,
  payload: { repository: { full_name: repo }, ...payload },
});

test("an opened issue with a matching label selects on-open, pending a collaborator check", () => {
  const matches = matchTriggers(
    outpost,
    delivery("issues", {
      action: "opened",
      issue: { body: "", labels: [{ name: "bug" }] },
      sender: { login: "bob" },
    }),
  );
  assert.deepEqual(matches, [
    { trigger: "on-open", author: { result: "check", sets: [{ kind: "collaborators" }] } },
  ]);
});

test("an issue without the label selects nothing", () => {
  const matches = matchTriggers(
    outpost,
    delivery("issues", { action: "opened", issue: { body: "", labels: [] } }),
  );
  assert.deepEqual(matches, []);
});

test("a comment mentioning @claude from alice is allowed, and from bob is denied", () => {
  const comment = (login: string) =>
    delivery("issue_comment", {
      action: "created",
      issue: { body: "" },
      comment: { body: "@Claude please fix" },
      sender: { login },
    });
  assert.deepEqual(matchTriggers(outpost, comment("alice")), [
    { trigger: "on-mention", author: { result: "allowed" } },
  ]);
  assert.deepEqual(matchTriggers(outpost, comment("bob")), [
    { trigger: "on-mention", author: { result: "denied" } },
  ]);
});

test("an edit matches only if it newly adds the mention", () => {
  const edit = (before: string) =>
    delivery("issue_comment", {
      action: "edited",
      issue: { body: "" },
      comment: { body: "@claude please fix" },
      changes: { body: { from: before } },
      sender: { login: "alice" },
    });
  assert.equal(matchTriggers(outpost, edit("please fix")).length, 1);
  assert.equal(matchTriggers(outpost, edit("@claude fix")).length, 0);
});

test("a channel with a scope covers that repo, not the outpost's", () => {
  const comment = (repo: string) =>
    delivery(
      "issue_comment",
      {
        action: "created",
        issue: { body: "" },
        comment: { body: "@claude" },
        sender: { login: "alice" },
      },
      repo,
    );
  assert.deepEqual(
    matchTriggers(outpost, comment("acme/docs")).map((m) => m.trigger),
    ["docs-mention"],
  );
  assert.deepEqual(
    matchTriggers(outpost, comment("acme/api")).map((m) => m.trigger),
    ["on-mention"],
  );
});
