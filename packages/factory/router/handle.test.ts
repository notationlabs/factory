import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutpostConfig } from "../contracts/outpost.ts";
import type { Delivery, Received, RemoteChannel } from "./channel.ts";
import { handle, type RouterStore } from "./handle.ts";

type FakeEvent = { allow: boolean };

const fake = (
  received: Received<FakeEvent>,
  sync: (url: string) => Promise<void> = async () => {},
): RemoteChannel<FakeEvent> => ({
  receive: async () => received,
  match: async (selector, delivery) =>
    (selector as { pick: boolean }).pick
      ? { result: delivery.data.allow ? "allowed" : "denied" }
      : undefined,
  sync,
  read: async () => ({ ref: "c0ffee", files: {} }),
  writeStatus: async () => {},
});

const accepted = (over: Partial<Delivery<FakeEvent>> = {}) =>
  fake({
    status: "accepted",
    delivery: {
      id: "d1",
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
    second: { provider: "fake", connection: "second", scope: "acme/api" },
    elsewhere: { provider: "other", connection: "main", scope: "acme/api" },
  },
  containers: {},
  policies: {},
  agents: {},
  triggers: {
    picked: { channel: "here", event: "post", match: { pick: true }, agent: "a", container: "c" },
    skipped: { channel: "here", event: "post", match: { pick: false }, agent: "a", container: "c" },
    "other-scope": { channel: "other", event: "post", match: { pick: true }, agent: "a", container: "c" },
    "other-connection": { channel: "second", event: "post", match: { pick: true }, agent: "a", container: "c" },
    "other-provider": { channel: "elsewhere", event: "post", match: { pick: true }, agent: "a", container: "c" },
    "other-event": { channel: "here", event: "reply", match: { pick: true }, agent: "a", container: "c" },
  },
};

const entry = (channel: string) => ({ provider: "fake", source: "1", credentials: {}, channel });

const store = (
  bound: Record<string, RemoteChannel<FakeEvent>>,
  outposts: Record<string, OutpostConfig> = { "acme/api": outpost },
): RouterStore => ({
  config: {
    connections: Object.fromEntries(
      Object.keys(bound).map((name) => [`fake/${name}`, entry(`CHANNEL_${name.toUpperCase()}`)]),
    ),
  },
  channel: (binding) =>
    Object.entries(bound).find(([name]) => `CHANNEL_${name.toUpperCase()}` === binding)?.[1] as
      | RemoteChannel
      | undefined,
  outpost: async (repo) => outposts[repo],
});

const post = (path: string) => new Request(`https://router.test${path}`, { method: "POST" });

const call = async (s: RouterStore, path = "/webhook/fake/main") => {
  const response = await handle(post(path), s);
  return { status: response.status, body: await response.json() };
};

test("matches only triggers on channels of the delivery's provider, connection, scope and event", async () => {
  const { status, body } = await call(store({ main: accepted() }));
  assert.equal(status, 202);
  assert.deepEqual(body.matches, [{ trigger: "picked", author: { result: "allowed" } }]);
});

test("a delivery to another connection's path matches that connection's triggers", async () => {
  const { body } = await call(store({ main: accepted(), second: accepted() }), "/webhook/fake/second");
  assert.deepEqual(body.matches, [{ trigger: "other-connection", author: { result: "allowed" } }]);
});

test("a rejected delivery is a 401, and an ignored one a 200", async () => {
  assert.equal((await call(store({ main: fake({ status: "rejected", reason: "bad signature" }) }))).status, 401);
  assert.equal((await call(store({ main: fake({ status: "ignored", reason: "ping" }) }))).status, 200);
});

test("a delivery for a repo with no outpost is ignored", async () => {
  const { status, body } = await call(store({ main: accepted() }, {}));
  assert.equal(status, 202);
  assert.equal(body.ignored, "no outpost");
});

test("a delivery to a connection with no channel is a 404", async () => {
  assert.equal((await call(store({ main: accepted() }), "/webhook/fake/unknown")).status, 404);
});

test("sync gives each channel its connection's webhook URL, and reports failures", async () => {
  const urls: string[] = [];
  const s = store({
    main: fake({ status: "ignored", reason: "" }, async (url) => void urls.push(url)),
    second: fake({ status: "ignored", reason: "" }, async () => {
      throw new Error("no access");
    }),
  });
  const { status, body } = await call(s, "/sync");
  assert.equal(status, 502);
  assert.deepEqual(urls, ["https://router.test/webhook/fake/main"]);
  assert.deepEqual(body.connections, { "fake/main": "ok", "fake/second": "no access" });
});

const sourceStore = (
  channel: RemoteChannel<FakeEvent>,
  calls: string[],
  allow = [{ owner: "acme" }],
): RouterStore => ({
  config: {
    connections: { "fake/main": entry("CHANNEL_MAIN") },
    codeHost: { provider: "fake", connection: "main", allow },
  },
  channel: (binding) => (binding === "CHANNEL_MAIN" ? (channel as RemoteChannel) : undefined),
  outpost: async () => undefined,
  deployer: {
    deploy: async (repo, source) => {
      calls.push(`deploy ${repo} ${source.ref}`);
      return { state: "deployed", ref: source.ref, at: "now" };
    },
    remove: async (repo) => void calls.push(`remove ${repo}`),
  },
});

const sourceChannel = (
  changes: { repo: string; ref?: string; removed?: boolean }[],
  calls: string[],
  read?: () => Promise<never>,
): RemoteChannel<FakeEvent> => ({
  ...fake({ status: "source", changes }),
  read:
    read ??
    (async (repo, dir, ref) => {
      calls.push(`read ${repo} ${dir} ${ref}`);
      return { ref: ref ?? "head", files: {} };
    }),
  writeStatus: async (repo, status) =>
    void calls.push(`status ${repo} ${status.state}${status.error ? `: ${status.error}` : ""}`),
});

test("a source change has the deployer deploy .factory/ as the channel reads it, and shows the status on the repo", async () => {
  const calls: string[] = [];
  const s = sourceStore(sourceChannel([{ repo: "acme/api", ref: "abc" }], calls), calls);
  const { status, body } = await call(s);
  assert.equal(status, 202);
  assert.deepEqual(body, { connection: "fake/main", deploying: ["acme/api"] });
  assert.deepEqual(calls, ["read acme/api .factory abc", "deploy acme/api abc", "status acme/api deployed"]);
});

test("a repo outside the code host's allow list loses its outpost, and says why", async () => {
  const calls: string[] = [];
  await call(sourceStore(sourceChannel([{ repo: "other/api" }], calls), calls));
  assert.deepEqual(calls, [
    "remove other/api",
    "status other/api failed: The hub doesn't serve other/api: the code host's allow list doesn't include it.",
  ]);
});

test("a repo the hub can no longer read loses its outpost", async () => {
  const calls: string[] = [];
  await call(sourceStore(sourceChannel([{ repo: "acme/api", removed: true }], calls), calls));
  assert.deepEqual(calls, ["remove acme/api"]);
});

test("a read that fails shows its error on the repo", async () => {
  const calls: string[] = [];
  const channel = sourceChannel([{ repo: "acme/api", ref: "abc" }], calls, async () => {
    throw new Error("no access");
  });
  await call(sourceStore(channel, calls));
  assert.deepEqual(calls, ["status acme/api failed: no access"]);
});

test("only the code host's connection deploys", async () => {
  const calls: string[] = [];
  const s = sourceStore(sourceChannel([{ repo: "acme/api" }], calls), calls);
  s.config.codeHost = { provider: "fake", connection: "other", allow: [{ owner: "acme" }] };
  const { status, body } = await call(s);
  assert.equal(status, 200);
  assert.deepEqual(body, { ignored: "not the code host's connection" });
  assert.deepEqual(calls, []);
});
