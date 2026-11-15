import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutpostConfig, RouterConfig } from "@notation/factory/router";
import { connectionForApp, matchTriggers, mentions, verifySignature } from "./index.ts";

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

const person = (login: string, association = "NONE", type = "User") => ({
  user: { login, type },
  author_association: association,
});

const issue = (author = person("alice", "COLLABORATOR"), labels: string[] = []) => ({
  body: "",
  labels: labels.map((name) => ({ name })),
  ...author,
});

const comment = (
  author: ReturnType<typeof person>,
  { body = "@claude please fix", on = issue(), repo = "acme/api" } = {},
) =>
  delivery(
    "issue_comment",
    {
      action: "created",
      issue: on,
      comment: { body, ...author },
      sender: author.user,
    },
    repo,
  );

const opened = (author: ReturnType<typeof person>, labels: string[]) =>
  delivery("issues", { action: "opened", issue: issue(author, labels), sender: author.user });

test("an opened issue from a collaborator with the label selects on-open", () => {
  assert.deepEqual(matchTriggers(outpost, opened(person("bob", "COLLABORATOR"), ["bug"])), [
    { trigger: "on-open", author: { result: "allowed" } },
  ]);
});

test("an opened issue from someone without write access is denied", () => {
  assert.deepEqual(matchTriggers(outpost, opened(person("eve", "CONTRIBUTOR"), ["bug"])), [
    { trigger: "on-open", author: { result: "denied" } },
  ]);
});

test("labels must all be on the issue", () => {
  const twoLabels = {
    ...outpost,
    triggers: {
      t: { ...outpost.triggers["on-open"]!, match: { actions: ["opened"], labels: ["bug", "p1"], from: { kind: "collaborators" } } },
    },
  };
  const author = person("bob", "COLLABORATOR");
  assert.equal(matchTriggers(twoLabels, opened(author, ["bug"])).length, 0);
  assert.equal(matchTriggers(twoLabels, opened(author, ["bug", "p1"])).length, 1);
  assert.equal(matchTriggers(outpost, opened(author, [])).length, 0);
});

test("a comment mentioning @claude from alice is allowed, and from bob is denied", () => {
  assert.deepEqual(matchTriggers(outpost, comment(person("alice"))), [
    { trigger: "on-mention", author: { result: "allowed" } },
  ]);
  assert.deepEqual(matchTriggers(outpost, comment(person("bob"))), [
    { trigger: "on-mention", author: { result: "denied" } },
  ]);
});

test("a comment on an issue whose author isn't in from is denied", () => {
  const stranger = issue(person("eve"));
  assert.deepEqual(matchTriggers(outpost, comment(person("alice"), { on: stranger })), [
    { trigger: "on-mention", author: { result: "denied" } },
  ]);
});

test("a bot is denied, even when it's in from", () => {
  assert.deepEqual(matchTriggers(outpost, comment(person("alice", "NONE", "Bot"))), [
    { trigger: "on-mention", author: { result: "denied" } },
  ]);
});

test("a team in from leaves a check for the router to make", () => {
  const teams = {
    ...outpost,
    triggers: {
      t: { ...outpost.triggers["on-mention"]!, match: { actions: ["created"], mention: "@claude", from: { kind: "team", slug: "acme/core" } } },
    },
  };
  assert.deepEqual(matchTriggers(teams, comment(person("bob"))), [
    { trigger: "t", author: { result: "check", sets: [{ kind: "team", slug: "acme/core" }] } },
  ]);
});

test("mentions match as GitHub does", () => {
  assert.equal(mentions("@Claude please", "@claude"), true);
  assert.equal(mentions("hi (@claude)", "@claude"), true);
  assert.equal(mentions("@claude.", "@claude"), true);
  assert.equal(mentions("@claudette", "@claude"), false);
  assert.equal(mentions("me@claude.ai", "@claude"), false);
  assert.equal(mentions("@claude-bot", "@claude"), false);
  assert.equal(mentions(null, "@claude"), false);
});

test("an edit matches only if it newly adds the mention", () => {
  const edit = (changes: object) => ({
    ...comment(person("alice")),
    payload: { ...comment(person("alice")).payload, action: "edited", changes },
  });
  assert.equal(matchTriggers(outpost, edit({ body: { from: "please fix" } })).length, 1);
  assert.equal(matchTriggers(outpost, edit({ body: { from: "@claude fix" } })).length, 0);
  // An edit that didn't touch the body has no changes.body.
  assert.equal(matchTriggers(outpost, edit({})).length, 0);
});

test("a channel with a scope covers that repo, not the outpost's", () => {
  const triggers = (repo: string) =>
    matchTriggers(outpost, comment(person("alice"), { repo })).map((m) => m.trigger);
  assert.deepEqual(triggers("acme/docs"), ["docs-mention"]);
  assert.deepEqual(triggers("acme/api"), ["on-mention"]);
});
