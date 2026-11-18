import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import type { Delivery } from "@notation/factory/router";
import { channel as github, type GithubEvent, mentions, verifySignature, webhookSecret } from "./index.ts";

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

const ROOT_KEY = "test-root-key";

const channel = github({
  secret: async (name) => (name === "ROOT_KEY" ? ROOT_KEY : ""),
  value: (name) => (name === "APP_ID" ? "123" : ""),
});

const request = async (event: string, payload: object, { appId = "123", sign = true } = {}) => {
  const body = JSON.stringify(payload);
  const secret = sign ? await webhookSecret(ROOT_KEY, appId) : "wrong";
  return new Request("https://router.test/webhook/github/acme-agents", {
    method: "POST",
    headers: {
      "x-github-event": event,
      "x-github-delivery": "d1",
      "x-github-hook-installation-target-id": appId,
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    },
    body,
  });
};

const commentPayload = {
  action: "created",
  repository: { full_name: "acme/api", default_branch: "main" },
  issue: { number: 7, title: "Broken", body: "It breaks", user: { login: "bob" }, labels: [{ name: "bug" }] },
  comment: { id: 99, body: "@claude fix", user: { login: "alice" }, author_association: "NONE" },
  sender: { login: "alice" },
};

test("receive parses a signed comment to its App", async () => {
  const received = await channel.receive(await request("issue_comment", commentPayload));
  assert.deepEqual(received, {
    status: "accepted",
    delivery: {
      id: "d1",
      scope: "acme/api",
      repo: "acme/api",
      event: "issue_comment",
      data: {
        action: "created",
        author: { login: "alice", association: "NONE", bot: false },
        opener: { login: "bob", association: "", bot: false },
        body: "@claude fix",
        before: "@claude fix",
        labels: ["bug"],
      },
      payload: {
        action: "created",
        issue: { number: 7, title: "Broken", body: "It breaks", labels: [{ name: "bug" }], user: { login: "bob" } },
        comment: { id: 99, body: "@claude fix", user: { login: "alice" } },
        repository: { full_name: "acme/api", default_branch: "main" },
        sender: { login: "alice" },
      },
    },
  });
});

test("receive ignores a comment that the App posted", async () => {
  const own = { ...commentPayload, comment: { ...commentPayload.comment, performed_via_github_app: { id: 123 } } };
  const received = await channel.receive(await request("issue_comment", own));
  assert.deepEqual(received, { status: "ignored", reason: "posted by this App" });
});

test("a comment's conversation is its issue, and its prompt quotes the issue and the comment", async () => {
  const received = await channel.receive(await request("issue_comment", commentPayload));
  assert.equal(received.status, "accepted");
  const conversation = channel.conversation!((received as { delivery: Delivery<GithubEvent> }).delivery);
  assert.equal(conversation.id, "github:acme/api#7");
  assert.deepEqual(conversation.thread, { repo: "acme/api", issue: 7 });
  assert.match(conversation.prompt, /acme\/api, on issue #7: Broken/);
  assert.match(conversation.prompt, /@bob opened it with:\nIt breaks/);
  assert.match(conversation.prompt, /@alice commented:\n@claude fix/);
});

test("receive rejects a bad signature and another App's delivery, and ignores a ping", async () => {
  const bad = await channel.receive(await request("issue_comment", commentPayload, { sign: false }));
  assert.equal(bad.status, "rejected");
  const unknown = await channel.receive(await request("issue_comment", commentPayload, { appId: "9" }));
  assert.equal(unknown.status, "rejected");
  const ping = await channel.receive(await request("ping", { zen: "hi" }));
  assert.equal(ping.status, "ignored");
});

const delivery = (data: Partial<GithubEvent>): Delivery<GithubEvent> => ({
  id: "d1",
  scope: "acme/api",
  repo: "acme/api",
  event: "issue_comment",
  data: {
    action: "created",
    author: { login: "alice", association: "NONE", bot: false },
    body: "@claude fix",
    before: "@claude fix",
    labels: [],
    ...data,
  },
  payload: {},
});

const selector = (over: object = {}) => ({
  actions: ["created", "edited"],
  mention: "@claude",
  from: { kind: "user", login: "alice" },
  ...over,
});

test("from allows a listed user, and a collaborator by author association", () => {
  assert.deepEqual(channel.match(selector(), delivery({})), { result: "allowed" });
  assert.deepEqual(
    channel.match(selector(), delivery({ author: { login: "bob", association: "NONE", bot: false } })),
    { result: "denied" },
  );
  const collaborators = selector({ from: { kind: "collaborators" } });
  assert.deepEqual(
    channel.match(collaborators, delivery({ author: { login: "bob", association: "COLLABORATOR", bot: false } })),
    { result: "allowed" },
  );
});

test("a comment matches only if the issue's author matches from too", () => {
  const collaborators = selector({ from: { kind: "collaborators" } });
  const member = { login: "alice", association: "MEMBER", bot: false };
  assert.deepEqual(
    channel.match(collaborators, delivery({ author: member, opener: { login: "eve", association: "NONE", bot: false } })),
    { result: "denied" },
  );
  assert.deepEqual(
    channel.match(collaborators, delivery({ author: member, opener: { login: "bob", association: "OWNER", bot: false } })),
    { result: "allowed" },
  );
});

test("bots never match, even with write access", () => {
  const collaborators = selector({ from: { kind: "collaborators" } });
  const bot = { login: "renovate[bot]", association: "MEMBER", bot: true };
  assert.deepEqual(channel.match(collaborators, delivery({ author: bot })), { result: "denied" });
  const human = { login: "alice", association: "MEMBER", bot: false };
  assert.deepEqual(channel.match(collaborators, delivery({ author: human, opener: bot })), { result: "denied" });
});

test("receive marks bot authors", async () => {
  const fromBot = {
    ...commentPayload,
    issue: { ...commentPayload.issue, user: { login: "dependabot[bot]", type: "Bot" }, author_association: "NONE" },
  };
  const received = await channel.receive(await request("issue_comment", fromBot));
  assert.equal(received.status, "accepted");
  const { data } = (received as { delivery: Delivery<GithubEvent> }).delivery;
  assert.deepEqual(data.opener, { login: "dependabot[bot]", association: "NONE", bot: true });
});

test("a team in from leaves a check for the router to make", () => {
  const team = selector({ from: [{ kind: "team", slug: "acme/core" }] });
  assert.deepEqual(
    channel.match(team, delivery({ author: { login: "bob", association: "NONE", bot: false } })),
    { result: "check", sets: [{ kind: "team", slug: "acme/core" }] },
  );
});

test("labels must all be on the issue", () => {
  const labelled = selector({ labels: ["bug", "p1"] });
  assert.equal(channel.match(labelled, delivery({ labels: ["bug"] })), undefined);
  assert.ok(channel.match(labelled, delivery({ labels: ["bug", "p1"] })));
});

test("an edit matches only if it newly adds the mention", () => {
  const edit = (before: string) => delivery({ action: "edited", before });
  assert.ok(channel.match(selector(), edit("fix")));
  assert.equal(channel.match(selector(), edit("@claude fix")), undefined);
});

test("mentions match as GitHub does", () => {
  assert.equal(mentions("@Claude please", "@claude"), true);
  assert.equal(mentions("hi (@claude)", "@claude"), true);
  assert.equal(mentions("@claude.", "@claude"), true);
  assert.equal(mentions("@claudette", "@claude"), false);
  assert.equal(mentions("me@claude.ai", "@claude"), false);
  assert.equal(mentions("@claude-bot", "@claude"), false);
});
