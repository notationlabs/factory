import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import type { Delivery, RouterContext } from "@notation/factory/router";
import { channel, type GithubEvent, mentions, verifySignature, webhookSecret } from "./index.ts";

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

const ctx: RouterContext = {
  config: {
    connections: {
      "slack/acme-agents": { provider: "slack", source: "123", credentials: {} },
      "github/acme-agents": { provider: "github", source: "123", credentials: {} },
    },
  },
  secret: async () => "",
  rootKey: async () => ROOT_KEY,
};

const request = async (event: string, payload: object, { appId = "123", sign = true } = {}) => {
  const body = JSON.stringify(payload);
  const secret = sign ? await webhookSecret(ROOT_KEY, appId) : "wrong";
  return new Request("https://router.test/webhook", {
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
  repository: { full_name: "acme/api" },
  issue: { body: "", labels: [{ name: "bug" }] },
  comment: { body: "@claude fix", user: { login: "alice" }, author_association: "NONE" },
};

test("receive finds the GitHub connection by App id and parses a signed comment", async () => {
  const received = await channel.receive(await request("issue_comment", commentPayload), ctx);
  assert.deepEqual(received, {
    status: "accepted",
    delivery: {
      id: "d1",
      connection: "acme-agents",
      scope: "acme/api",
      repo: "acme/api",
      event: "issue_comment",
      data: {
        action: "created",
        author: { login: "alice", association: "NONE" },
        body: "@claude fix",
        before: "@claude fix",
        labels: ["bug"],
      },
    },
  });
});

test("receive rejects a bad signature and an unknown App, and ignores a ping", async () => {
  const bad = await channel.receive(await request("issue_comment", commentPayload, { sign: false }), ctx);
  assert.equal(bad.status, "rejected");
  const unknown = await channel.receive(await request("issue_comment", commentPayload, { appId: "9" }), ctx);
  assert.equal(unknown.status, "rejected");
  const ping = await channel.receive(await request("ping", { zen: "hi" }), ctx);
  assert.equal(ping.status, "ignored");
});

const delivery = (data: Partial<GithubEvent>): Delivery<GithubEvent> => ({
  id: "d1",
  connection: "acme-agents",
  scope: "acme/api",
  repo: "acme/api",
  event: "issue_comment",
  data: {
    action: "created",
    author: { login: "alice", association: "NONE" },
    body: "@claude fix",
    before: "@claude fix",
    labels: [],
    ...data,
  },
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
    channel.match(selector(), delivery({ author: { login: "bob", association: "NONE" } })),
    { result: "denied" },
  );
  const collaborators = selector({ from: { kind: "collaborators" } });
  assert.deepEqual(
    channel.match(collaborators, delivery({ author: { login: "bob", association: "COLLABORATOR" } })),
    { result: "allowed" },
  );
});

test("a team in from leaves a check for the router to make", () => {
  const team = selector({ from: [{ kind: "team", slug: "acme/core" }] });
  assert.deepEqual(
    channel.match(team, delivery({ author: { login: "bob", association: "NONE" } })),
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
