import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutpostConfig } from "../contracts/outpost.ts";
import type { Delivery, Received, RemoteChannel } from "./channel.ts";
import { handle, type RemoteDeployer, type RouterStore } from "./handle.ts";
import { type Run, signBuildReport, signMessage, signTicket, signTokenTicket } from "./run.ts";

const ROOT_KEY = "root";

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
  writeCheck: async () => {},
  conversation: async (delivery) => ({ id: `fake:${delivery.repo}`, message: "p1", thread: { repo: delivery.repo } }),
  messages: async () => [],
  acknowledge: async () => {},
  reply: async () => undefined,
  token: async (repo, permissions) => `token:${repo}:${JSON.stringify(permissions)}`,
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
      payload: { number: 1 },
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
  rootKey: async () => ROOT_KEY,
});

/** The matches without their runs' random ids. */
const matched = (matches: { run?: string }[]) => matches.map(({ run, ...m }) => ({ ...m, run: typeof run }));

const post = (path: string) => new Request(`https://router.test${path}`, { method: "POST" });

const call = async (s: RouterStore, path = "/webhook/fake/main") => {
  const response = await handle(post(path), s);
  return { status: response.status, body: await response.json() };
};

test("matches only triggers on channels of the delivery's provider, connection, scope and event", async () => {
  const { status, body } = await call(store({ main: accepted() }));
  assert.equal(status, 202);
  assert.deepEqual(matched(body.matches), [{ trigger: "picked", author: { result: "allowed" }, run: "string" }]);
});

test("a delivery to another connection's path matches that connection's triggers", async () => {
  const { body } = await call(store({ main: accepted(), second: accepted() }), "/webhook/fake/second");
  assert.deepEqual(matched(body.matches), [{ trigger: "other-connection", author: { result: "allowed" }, run: "string" }]);
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
  rootKey: async () => ROOT_KEY,
  deployer: {
    worktree: async () => undefined,
    run: async () => {},
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

test("a deploy that starts builds shows a queued check on the commit for each container", async () => {
  const calls: string[] = [];
  const channel: RemoteChannel<FakeEvent> = {
    ...sourceChannel([{ repo: "acme/api", ref: "abc" }], calls),
    writeCheck: async (repo, ref, check) => void calls.push(`check ${repo} ${ref} ${check.name} ${check.state}`),
  };
  const s = sourceStore(channel, calls);
  s.deployer!.deploy = async (_repo, source) => ({ state: "deployed", ref: source.ref, at: "now", builds: ["dev", "ci"] });
  await call(s);
  assert.deepEqual(calls, [
    "read acme/api .factory abc",
    "status acme/api deployed",
    "check acme/api abc factory/build dev queued",
    "check acme/api abc factory/build ci queued",
  ]);
});

test("a check that the channel can't write doesn't fail the deploy", async () => {
  const calls: string[] = [];
  const channel: RemoteChannel<FakeEvent> = {
    ...sourceChannel([{ repo: "acme/api", ref: "abc" }], calls),
    writeCheck: async () => {
      throw new Error("no checks permission");
    },
  };
  const s = sourceStore(channel, calls);
  s.deployer!.deploy = async (_repo, source) => ({ state: "deployed", ref: source.ref, at: "now", builds: ["dev"] });
  const { status } = await call(s);
  assert.equal(status, 202);
  assert.deepEqual(calls, ["read acme/api .factory abc", "status acme/api deployed"]);
});

const buildReport = (s: RouterStore, body: unknown) =>
  handle(new Request("https://router.test/builds", { method: "POST", body: JSON.stringify(body) }), s);

test("builds writes a check from a report the deployer signed, through the code host's channel", async () => {
  const checks: unknown[] = [];
  const channel: RemoteChannel<FakeEvent> = {
    ...sourceChannel([], []),
    writeCheck: async (repo, ref, check) => void checks.push([repo, ref, check]),
  };
  const s = sourceStore(channel, []);
  const report = {
    repo: "acme/api",
    ref: "abc",
    container: "dev",
    state: "failure" as const,
    url: "https://dash.test/build",
    expires: Date.now() + 60_000,
  };
  const signature = await signBuildReport(ROOT_KEY, report);

  assert.equal((await buildReport(s, { report, signature })).status, 200);
  assert.deepEqual(checks, [["acme/api", "abc", { name: "factory/build dev", state: "failure", url: "https://dash.test/build" }]]);

  const forged = { ...report, state: "success" };
  assert.equal((await buildReport(s, { report: forged, signature })).status, 401);
  const expired = { ...report, expires: Date.now() - 1 };
  assert.equal((await buildReport(s, { report: expired, signature: await signBuildReport(ROOT_KEY, expired) })).status, 401);
  // A token ticket's signature doesn't sign a build report.
  assert.equal((await buildReport(s, { report, signature: await signTokenTicket(ROOT_KEY, report as never) })).status, 401);
  assert.equal(checks.length, 1);
});

const runOutpost: OutpostConfig = {
  channels: { here: { provider: "fake", connection: "main", scope: "acme/api" } },
  containers: { dev: { image: "./Dockerfile", runtimes: ["claude"], policies: ["code", "docs"], files: {} } },
  policies: {
    code: { provider: "fake", permissions: { contents: "write" } },
    docs: { provider: "fake", repo: "acme/docs", permissions: { contents: "read" } },
  },
  agents: { coder: { runtime: "claude", model: "m" } },
  triggers: {
    mention: {
      channel: "here",
      event: "post",
      match: { pick: true },
      agent: "coder",
      container: "dev",
      worktree: { base: "develop" },
    },
  },
};

const runStore = (channel: RemoteChannel<FakeEvent>, deployer: Partial<RemoteDeployer>): RouterStore => ({
  ...store({ main: channel }, { "acme/api": runOutpost }),
  config: {
    connections: { "fake/main": entry("CHANNEL_MAIN") },
    codeHost: { provider: "fake", connection: "main", allow: [{ owner: "acme" }] },
  },
  deployer: {
    deploy: async () => ({ state: "deployed", at: "now" }),
    remove: async () => {},
    worktree: async () => undefined,
    run: async () => {},
    ...deployer,
  },
});

test("a match whose author may start a run hands the deployer a run, with its branch, tokens and a ticket for its thread", async () => {
  const runs: Run[] = [];
  const worktrees: unknown[] = [];
  const s = runStore(accepted(), {
    worktree: async (repo, trigger, payload) => {
      worktrees.push([repo, trigger, payload]);
      return "issue-1";
    },
    run: async (run) => void runs.push(run),
  });
  const { body } = await call(s);
  assert.equal(runs.length, 1);
  const [run] = runs;
  assert.equal(run!.id, body.matches[0].run);
  assert.deepEqual(worktrees, [["acme/api", "mention", { number: 1 }]]);
  assert.deepEqual(run!.worktree, { branch: "issue-1", base: "develop" });
  assert.equal(run!.container, "dev");
  assert.deepEqual(run!.runtimes, ["claude"]);
  assert.deepEqual(run!.agent, { id: "coder", runtime: "claude", model: "m" });
  assert.deepEqual(run!.conversation, { id: "fake:acme/api", message: "p1" });
  assert.equal(run!.cloneToken, 'token:acme/api:{"contents":"read"}');
  assert.deepEqual(run!.tokens, [
    { policy: "code", repo: "acme/api", token: 'token:acme/api:{"contents":"write"}' },
    { policy: "docs", repo: "acme/docs", token: 'token:acme/docs:{"contents":"read"}' },
  ]);
  assert.equal(run!.refresh.url, "https://router.test/tokens");
  assert.equal(run!.refresh.ticket.repo, "acme/api");
  assert.equal(run!.refresh.ticket.container, "dev");
  assert.equal(run!.refresh.signature, await signTokenTicket(ROOT_KEY, run!.refresh.ticket));
  assert.equal(run!.reply.url, "https://router.test/relay");
  assert.deepEqual(run!.reply.ticket.thread, { repo: "acme/api" });
  assert.equal(run!.reply.signature, await signTicket(ROOT_KEY, run!.reply.ticket));
});

test("a worktree function that names no branch runs in a scratch worktree", async () => {
  const runs: Run[] = [];
  await call(runStore(accepted(), { run: async (run) => void runs.push(run) }));
  assert.equal(runs[0]!.worktree, undefined);
});

test("a run that can't start replies with the error", async () => {
  const replies: unknown[] = [];
  const runs: Run[] = [];
  const channel = { ...accepted(), reply: async (thread: unknown, text: string) => void replies.push([thread, text]) };
  await call(runStore(channel, { worktree: async () => "../etc", run: async (run) => void runs.push(run) }));
  assert.equal(runs.length, 0);
  assert.equal(replies.length, 1);
  assert.match((replies[0] as string[])[1]!, /returned "\.\.\/etc", which isn't a branch name/);
});

test("a denied author starts no run", async () => {
  const runs: Run[] = [];
  const acknowledged: unknown[] = [];
  const channel = { ...accepted({ data: { allow: false } }), acknowledge: async (d: Delivery<FakeEvent>) => void acknowledged.push(d.id) };
  const { body } = await call(runStore(channel, { run: async (run) => void runs.push(run) }));
  assert.deepEqual(body.matches, [{ trigger: "mention", author: { result: "denied" } }]);
  assert.equal(runs.length, 0);
  assert.deepEqual(acknowledged, []);
});

test("a delivery that starts a run is acknowledged once, before the run is handed to the deployer", async () => {
  const events: string[] = [];
  const channel = { ...accepted(), acknowledge: async (d: Delivery<FakeEvent>) => void events.push(`acknowledge ${d.id}`) };
  await call(runStore(channel, { run: async () => void events.push("run") }));
  assert.deepEqual(events, ["acknowledge d1", "run"]);
});

test("a run starts even if the channel can't acknowledge its delivery", async () => {
  const runs: Run[] = [];
  const channel = {
    ...accepted(),
    acknowledge: async () => {
      throw new Error("no reactions");
    },
  };
  await call(runStore(channel, { run: async (run) => void runs.push(run) }));
  assert.equal(runs.length, 1);
});

const relay = (s: RouterStore, body: unknown) =>
  handle(new Request("https://router.test/relay", { method: "POST", body: JSON.stringify(body) }), s);

test("relay posts a reply with a ticket the router signed through the ticket's channel", async () => {
  const replies: unknown[] = [];
  const s = runStore({ ...accepted(), reply: async (thread, text) => void replies.push([thread, text]) }, {});
  const ticket = { connection: "fake/main", thread: { repo: "acme/api" }, expires: Date.now() + 60_000 };
  const signature = await signTicket(ROOT_KEY, ticket);

  assert.equal((await relay(s, { ticket, signature, text: "done" })).status, 200);
  assert.deepEqual(replies, [[{ repo: "acme/api" }, "done"]]);

  const forged = { ...ticket, thread: { repo: "acme/other" } };
  assert.equal((await relay(s, { ticket: forged, signature, text: "x" })).status, 401);
  const expired = { ...ticket, expires: Date.now() - 1 };
  assert.equal((await relay(s, { ticket: expired, signature: await signTicket(ROOT_KEY, expired), text: "x" })).status, 401);
  assert.equal(replies.length, 1);
});

test("relay answers with the message it posted, signed, and a reply with that message replaces it", async () => {
  const replies: unknown[] = [];
  const channel = {
    ...accepted(),
    reply: async (thread: unknown, text: string, message?: string) => {
      replies.push([text, message]);
      return message ?? "m1";
    },
  };
  const s = runStore(channel, {});
  const ticket = { connection: "fake/main", thread: { repo: "acme/api" }, expires: Date.now() + 60_000 };
  const signature = await signTicket(ROOT_KEY, ticket);

  const first = await (await relay(s, { ticket, signature, text: "working" })).json();
  assert.deepEqual(first, { ok: true, message: { id: "m1", signature: await signMessage(ROOT_KEY, signature, "m1") } });
  assert.equal((await relay(s, { ticket, signature, text: "done", message: first.message })).status, 200);
  assert.deepEqual(replies, [["working", undefined], ["done", "m1"]]);

  // A run can't replace a message that it didn't post.
  const other = { id: "m2", signature: first.message.signature };
  assert.equal((await relay(s, { ticket, signature, text: "x", message: other })).status, 401);
  const otherTicket = { ...ticket, expires: ticket.expires + 1 };
  const otherSignature = await signTicket(ROOT_KEY, otherTicket);
  assert.equal((await relay(s, { ticket: otherTicket, signature: otherSignature, text: "x", message: first.message })).status, 401);
  assert.equal((await relay(s, { ticket, signature, text: "x", message: { id: 1 } })).status, 400);
  assert.equal(replies.length, 2);
});

const readMessages = (s: RouterStore, body: unknown) =>
  handle(new Request("https://router.test/messages", { method: "POST", body: JSON.stringify(body) }), s);

test("messages answers a thread's messages for a reply ticket the router signed, through the ticket's channel", async () => {
  const reads: unknown[] = [];
  const message = { id: "1", author: "@alice", body: "fix it", role: "write", canTrigger: true };
  const channel = {
    ...accepted(),
    messages: async (thread: unknown) => {
      reads.push(thread);
      return [message];
    },
  };
  const s = runStore(channel, {});
  const ticket = { connection: "fake/main", thread: { repo: "acme/api" }, expires: Date.now() + 60_000 };
  const signature = await signTicket(ROOT_KEY, ticket);

  const response = await readMessages(s, { ticket, signature });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { messages: [message] });
  assert.deepEqual(reads, [{ repo: "acme/api" }]);

  // A run can't read another thread.
  assert.equal((await readMessages(s, { ticket: { ...ticket, thread: { repo: "acme/other" } }, signature })).status, 401);
  assert.equal(reads.length, 1);
});

test("messages reports a channel that can't read the thread", async () => {
  const channel = {
    ...accepted(),
    messages: async () => {
      throw new Error("GitHub is down");
    },
  };
  const ticket = { connection: "fake/main", thread: { repo: "acme/api" }, expires: Date.now() + 60_000 };
  const response = await readMessages(runStore(channel, {}), { ticket, signature: await signTicket(ROOT_KEY, ticket) });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "GitHub is down" });
});

const refresh = (s: RouterStore, body: unknown) =>
  handle(new Request("https://router.test/tokens", { method: "POST", body: JSON.stringify(body) }), s);

test("tokens mints a container's policy tokens again with a ticket the router signed", async () => {
  const s = runStore(accepted(), {});
  const ticket = { repo: "acme/api", container: "dev", expires: Date.now() + 60_000 };
  const signature = await signTokenTicket(ROOT_KEY, ticket);

  const response = await refresh(s, { ticket, signature });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [
    { policy: "code", repo: "acme/api", token: 'token:acme/api:{"contents":"write"}' },
    { policy: "docs", repo: "acme/docs", token: 'token:acme/docs:{"contents":"read"}' },
  ]);

  const forged = { ...ticket, repo: "acme/other" };
  assert.equal((await refresh(s, { ticket: forged, signature })).status, 401);
  const expired = { ...ticket, expires: Date.now() - 1 };
  assert.equal((await refresh(s, { ticket: expired, signature: await signTokenTicket(ROOT_KEY, expired) })).status, 401);
  // A reply ticket's signature doesn't sign a token ticket.
  assert.equal((await refresh(s, { ticket, signature: await signTicket(ROOT_KEY, ticket as never) })).status, 401);
});

test("tokens refuses a container that the repo's outpost no longer has", async () => {
  const s = runStore(accepted(), {});
  const ticket = { repo: "acme/api", container: "gone", expires: Date.now() + 60_000 };
  const response = await refresh(s, { ticket, signature: await signTokenTicket(ROOT_KEY, ticket) });
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /no container gone/);
});
