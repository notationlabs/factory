import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutpostConfig } from "../contracts/outpost.ts";
import type { ChannelProvider, Received } from "./channel.ts";
import { handle, type RouterStore } from "./handle.ts";

type FakeEvent = { allow: boolean };

const fake = (received: Received<FakeEvent>): ChannelProvider<FakeEvent> => ({
  provider: "fake",
  receives: (request) => request.headers.has("x-fake"),
  receive: async () => received,
  match: (selector, delivery) =>
    (selector as { pick: boolean }).pick
      ? { result: delivery.data.allow ? "allowed" : "denied" }
      : undefined,
});

const accepted = (over: Partial<{ connection: string; scope: string; event: string }> = {}) =>
  fake({
    status: "accepted",
    delivery: {
      id: "d1",
      connection: "main",
      scope: "acme/api",
      repo: "acme/api",
      event: "post",
      data: { allow: true },
      ...over,
    },
  });

const outpost: OutpostConfig = {
  channels: {
    here: { provider: "fake", connection: "main", scope: "acme/api" },
    other: { provider: "fake", connection: "main", scope: "acme/docs" },
    elsewhere: { provider: "other", connection: "main", scope: "acme/api" },
  },
  containers: {},
  policies: {},
  agents: {},
  triggers: {
    picked: { channel: "here", event: "post", match: { pick: true }, agent: "a", container: "c" },
    skipped: { channel: "here", event: "post", match: { pick: false }, agent: "a", container: "c" },
    "other-scope": { channel: "other", event: "post", match: { pick: true }, agent: "a", container: "c" },
    "other-provider": { channel: "elsewhere", event: "post", match: { pick: true }, agent: "a", container: "c" },
    "other-event": { channel: "here", event: "reply", match: { pick: true }, agent: "a", container: "c" },
  },
};

const store = (outposts: Record<string, OutpostConfig> = { "acme/api": outpost }): RouterStore => ({
  config: {},
  secret: async () => "",
  rootKey: async () => "",
  outpost: async (repo) => outposts[repo],
});

const post = (path = "/webhook") =>
  new Request(`https://router.test${path}`, { method: "POST", headers: { "x-fake": "1" } });

const call = async (provider: ChannelProvider<FakeEvent>, s = store()) => {
  const response = await handle(post(), [provider as ChannelProvider], s);
  return { status: response.status, body: await response.json() };
};

test("matches only triggers on channels of the delivery's provider, connection, scope and event", async () => {
  const { status, body } = await call(accepted());
  assert.equal(status, 202);
  assert.deepEqual(body.matches, [{ trigger: "picked", author: { result: "allowed" } }]);
});

test("a delivery on another connection matches nothing", async () => {
  const { body } = await call(accepted({ connection: "second" }));
  assert.deepEqual(body.matches, []);
});

test("a rejected delivery is a 401, and an ignored one a 200", async () => {
  assert.equal((await call(fake({ status: "rejected", reason: "bad signature" }))).status, 401);
  assert.equal((await call(fake({ status: "ignored", reason: "ping" }))).status, 200);
});

test("a delivery for a repo with no outpost is ignored", async () => {
  const { status, body } = await call(accepted(), store({}));
  assert.equal(status, 202);
  assert.equal(body.ignored, "no outpost");
});

test("a request no provider receives is a 400", async () => {
  const response = await handle(
    new Request("https://router.test/webhook", { method: "POST" }),
    [accepted() as ChannelProvider],
    store(),
  );
  assert.equal(response.status, 400);
});
