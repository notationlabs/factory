import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutpostConfig } from "../contracts/outpost.ts";
import type { Delivery, Received, RemoteChannel } from "./channel.ts";
import {
  BUILD_POLL_MS,
  BUILD_WAIT_MS,
  type DeliveryRecord,
  failedDelivery,
  heartbeatWatch,
  type Inbox,
  LOST_ERROR,
  lostNotice,
  mergeRecord,
  nextTry,
  replayRecord,
  type Watch,
} from "./deliveries.ts";
import { type RepoDeploy, signSession, verifySession } from "./admin.ts";
import { advance, handle, type RemoteDeployer, type RouterStore, watch } from "./handle.ts";
import { LOST_AFTER_MS, type Run, signBuildReport, signMessage, signRestart, signTicket, signTokenTicket } from "./run.ts";
import { SYNC_HEADER, signSync } from "./sync.ts";

const ROOT_KEY = "root";
const SYNC_KEY = "sync";
const ORIGIN = "https://router.test";

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
  unacknowledge: async () => {},
  reply: async () => undefined,
  token: async (repo, permissions) => `token:${repo}:${JSON.stringify(permissions)}`,
  repos: async () => [],
  signInUrl: async (state, redirect) => `https://sign-in.test/?state=${encodeURIComponent(state)}${redirect ? `&redirect=${redirect}` : ""}`,
  // A code of `code-<login>-<id>` signs in as that user.
  signIn: async (code) => {
    const [login = "", id = "0"] = code.replace(/^code-/, "").split("-");
    return { login, id };
  },
  // Only alice may trigger the agent.
  canTrigger: async (_selector, _delivery, person) => person.login === "alice",
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

/** The store of the last `call`, which `atOnce` dispatches against. */
let calling: RouterStore;

/** An inbox that dispatches each delivery once, as soon as the router saves it. */
const atOnce: Inbox = {
  receive: async (record) => (await advance(record, calling), true),
  failed: async () => [],
  replay: async () => false,
  heartbeat: async () => "unknown",
  record: async () => undefined,
  restart: async () => false,
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
  inbox: atOnce,
});

/** The matches without their runs' random ids. */
const matched = (matches: { run?: string }[]) => matches.map(({ run, ...m }) => ({ ...m, run: typeof run }));

const post = (path: string) => new Request(`https://router.test${path}`, { method: "POST" });

const call = async (s: RouterStore, path = "/webhook/fake/main") => {
  calling = s;
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

const syncCall = async (s: RouterStore, header?: string) => {
  const response = await handle(
    new Request("https://router.test/sync", { method: "POST", ...(header && { headers: { [SYNC_HEADER]: header } }) }),
    s,
  );
  return { status: response.status, body: await response.json() };
};

test("sync gives each channel its connection's webhook URL, and reports failures", async () => {
  const urls: string[] = [];
  const s: RouterStore = {
    ...store({
      main: fake({ status: "ignored", reason: "" }, async (url) => void urls.push(url)),
      second: fake({ status: "ignored", reason: "" }, async () => {
        throw new Error("no access");
      }),
    }),
    syncKey: async () => SYNC_KEY,
  };
  const { status, body } = await syncCall(s, await signSync(SYNC_KEY, ORIGIN));
  assert.equal(status, 502);
  assert.deepEqual(urls, ["https://router.test/webhook/fake/main"]);
  assert.deepEqual(body.connections, { "fake/main": "ok", "fake/second": "no access" });
});

test("sync takes only a recent request signed with the sync key", async () => {
  const urls: string[] = [];
  const s: RouterStore = { ...store({ main: fake({ status: "ignored", reason: "" }, async (url) => void urls.push(url)) }), syncKey: async () => SYNC_KEY };
  assert.equal((await syncCall(s)).status, 401);
  assert.equal((await syncCall(s, await signSync("other", ORIGIN))).status, 401);
  assert.equal((await syncCall(s, await signSync(SYNC_KEY, "https://other-router.test"))).status, 401);
  assert.equal((await syncCall(s, await signSync(SYNC_KEY, ORIGIN, Date.now() - 10 * 60 * 1000))).status, 401);
  assert.equal((await syncCall(s, (await signSync(SYNC_KEY, ORIGIN)).replace(/^\d+/, (at) => String(Number(at) + 1)))).status, 401);
  assert.equal((await syncCall({ ...s, syncKey: undefined }, await signSync(SYNC_KEY, ORIGIN))).status, 501);
  assert.deepEqual(urls, []);
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
  inbox: atOnce,
  deployer: {
    worktree: async () => undefined,
    run: async () => "queued",
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
    run: async () => "queued",
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
    run: async (run) => (runs.push(run), "queued" as const),
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
  await call(runStore(accepted(), { run: async (run) => (runs.push(run), "queued" as const) }));
  assert.equal(runs[0]!.worktree, undefined);
});

test("a run that can't start replies with the error", async () => {
  const replies: unknown[] = [];
  const runs: Run[] = [];
  const channel = { ...accepted(), reply: async (thread: unknown, text: string) => void replies.push([thread, text]) };
  await call(runStore(channel, { worktree: async () => "../etc", run: async (run) => (runs.push(run), "queued" as const) }));
  assert.equal(runs.length, 0);
  assert.equal(replies.length, 1);
  assert.match((replies[0] as string[])[1]!, /returned "\.\.\/etc", which isn't a branch name/);
});

test("a denied author starts no run", async () => {
  const runs: Run[] = [];
  const acknowledged: unknown[] = [];
  const channel = { ...accepted({ data: { allow: false } }), acknowledge: async (d: Delivery<FakeEvent>) => void acknowledged.push(d.id) };
  const { body } = await call(runStore(channel, { run: async (run) => (runs.push(run), "queued" as const) }));
  assert.deepEqual(body.matches, [{ trigger: "mention", author: { result: "denied" } }]);
  assert.equal(runs.length, 0);
  assert.deepEqual(acknowledged, []);
});

test("a delivery that starts a run is acknowledged once, before the run is handed to the deployer", async () => {
  const events: string[] = [];
  const channel = { ...accepted(), acknowledge: async (d: Delivery<FakeEvent>) => void events.push(`acknowledge ${d.id}`) };
  await call(runStore(channel, { run: async () => (events.push("run"), "queued" as const) }));
  assert.deepEqual(events, ["acknowledge d1", "run"]);
});

test("acknowledge gets the selectors of the triggers that start runs", async () => {
  const selectors: unknown[] = [];
  const channel = { ...accepted(), acknowledge: async (_: Delivery<FakeEvent>, s: unknown[]) => void selectors.push(s) };
  await call(runStore(channel, {}));
  assert.deepEqual(selectors, [[{ pick: true }]]);
});

test("a run starts even if the channel can't acknowledge its delivery", async () => {
  const runs: Run[] = [];
  const channel = {
    ...accepted(),
    acknowledge: async () => {
      throw new Error("no reactions");
    },
  };
  await call(runStore(channel, { run: async (run) => (runs.push(run), "queued" as const) }));
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

/** An inbox that keeps records in memory, by connection and id. It dispatches only when a test calls `advance`. */
const memoryInbox = () => {
  const records = new Map<string, DeliveryRecord>();
  const watches = new Map<string, Watch>();
  const inbox: Inbox = {
    receive: async (record) => {
      const key = `${record.connection}/${record.id}`;
      if (records.has(key)) return false;
      records.set(key, structuredClone(record));
      return true;
    },
    failed: async () => [],
    replay: async () => false,
    heartbeat: async (connection, id, run, beat) => {
      const { result, watch } = heartbeatWatch(records.get(`${connection}/${id}`), run, watches.get(run), beat, Date.now());
      if (watch) watches.set(run, watch);
      return result;
    },
    record: async (connection, id) => records.get(`${connection}/${id}`),
    restart: async (connection, id, run, origin) => {
      const record = records.get(`${connection}/${id}`);
      return record ? replayRecord(record, origin, run) : false;
    },
  };
  return { inbox, records, watches };
};

test("with an inbox, a delivery is saved before the router answers, and a second delivery with its id is a duplicate", async () => {
  const runs: Run[] = [];
  const { inbox, records } = memoryInbox();
  const s = { ...runStore(accepted(), { run: async (run) => (runs.push(run), "queued" as const) }), inbox };
  const first = await call(s);
  assert.equal(first.status, 202);
  assert.deepEqual([...records.keys()], ["fake/main/d1"]);
  const [record] = records.values();
  assert.deepEqual(record!.dispatches, [{ trigger: "mention", run: first.body.matches[0].run, state: "pending" }]);
  assert.equal(runs.length, 0);

  const second = await call(s);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(records.size, 1);

  assert.equal(await advance(record!, s), undefined);
  assert.equal(runs.length, 1);
  assert.equal(record!.dispatches[0]!.state, "dispatched");
});

test("a delivery with no id isn't taken for a duplicate", async () => {
  const { inbox, records } = memoryInbox();
  const s = { ...runStore(accepted({ id: "" }), {}), inbox };
  await call(s);
  await call(s);
  assert.equal(records.size, 2);
});

const memoryDeploys = (): NonNullable<RouterStore["deploys"]> & { saved: Map<string, unknown> } => {
  const saved = new Map<string, RepoDeploy>();
  return {
    saved,
    put: async (repo, status) => void saved.set(repo.toLowerCase(), { repo, status, builds: saved.get(repo.toLowerCase())?.builds ?? {} }),
    remove: async (repo) => void saved.delete(repo.toLowerCase()),
    build: async (repo, container) => saved.get(repo.toLowerCase())?.builds[container],
    putBuild: async (repo, container, build) => {
      const deploy = saved.get(repo.toLowerCase()) ?? { repo, status: { state: "deployed", at: "" }, builds: {} };
      saved.set(repo.toLowerCase(), { ...deploy, builds: { ...deploy.builds, [container]: build } });
    },
    pruneBuilds: async (repo, containers) => {
      const deploy = saved.get(repo.toLowerCase());
      if (deploy) deploy.builds = Object.fromEntries(Object.entries(deploy.builds).filter(([c]) => containers.includes(c)));
    },
    list: async () => structuredClone([...saved.values()]),
    repos: async () => [...saved.keys()],
  };
};

const savedRecord = async (s: RouterStore) => {
  const { inbox, records, watches } = memoryInbox();
  await call({ ...s, inbox });
  return { record: [...records.values()][0]!, store: { ...s, inbox }, watches };
};

test("a dispatch whose container's first image build hasn't finished waits for it, and its run replaces the waiting message", async () => {
  const replies: unknown[][] = [];
  const results = ["building", "building", "queued"] as const;
  const runs: Run[] = [];
  const channel = {
    ...accepted(),
    reply: async (_thread: unknown, text: string, message?: string) => {
      replies.push([text, message]);
      return "w1";
    },
  };
  const { record, store } = await savedRecord(runStore(channel, { run: async (run) => (runs.push(run), results[runs.length - 1]!) }));
  const start = 1_000_000;

  assert.equal(await advance(record, store, start), start + BUILD_POLL_MS);
  assert.deepEqual(replies, [["> Booting container `dev`...", undefined]]);

  // Not due yet.
  assert.equal(await advance(record, store, start + 1_000), start + BUILD_POLL_MS);
  assert.equal(runs.length, 1);

  assert.equal(await advance(record, store, start + BUILD_POLL_MS), start + 2 * BUILD_POLL_MS);
  assert.equal(replies.length, 1);

  assert.equal(await advance(record, store, start + 2 * BUILD_POLL_MS), undefined);
  assert.equal(record.dispatches[0]!.state, "dispatched");
  const run = runs[2]!;
  assert.equal(run.id, runs[0]!.id);
  assert.deepEqual(run.reply.message, { id: "w1", signature: await signMessage(ROOT_KEY, run.reply.signature, "w1") });
  assert.equal(replies.length, 1);
});

test("a dispatch whose container's build fails replaces the waiting message with the build's error", async () => {
  const replies: unknown[][] = [];
  const channel = {
    ...accepted(),
    reply: async (_thread: unknown, text: string, message?: string) => {
      replies.push([text, message]);
      return "w1";
    },
  };
  const deploys = memoryDeploys();
  const { record, store } = await savedRecord({ ...runStore(channel, { run: async () => "building" }), deploys });
  await deploys.putBuild("acme/api", "dev", { state: "in_progress", ref: "abc", url: "https://builds/1", at: "now" });
  assert.equal(await advance(record, store, 0), BUILD_POLL_MS);

  await deploys.putBuild("acme/api", "dev", { state: "failure", ref: "abc", url: "https://builds/1", summary: "Workers Builds: fail.", at: "now" });
  assert.equal(await advance(record, store, BUILD_POLL_MS), undefined);
  assert.equal(record.dispatches[0]!.state, "failed");
  assert.equal(replies.length, 2);
  assert.equal(replies[1]![1], "w1");
  assert.match(replies[1]![0] as string, /`mention`: The first image build of container `dev` failed\. Workers Builds: fail\. The build's log: https:\/\/builds\/1/);
  assert.match(replies[1]![0] as string, /`factory infra replay`/);

  // A settled delivery posts nothing more.
  await advance(record, store, BUILD_POLL_MS + 1);
  assert.equal(replies.length, 2);
});

test("a dispatch isn't tried again while the deploy log says its container's build is queued or in progress", async () => {
  const runs: Run[] = [];
  const deploys = memoryDeploys();
  const { record, store } = await savedRecord({
    ...runStore(accepted(), { run: async (run) => (runs.push(run), runs.length === 1 ? "building" : "queued") }),
    deploys,
  });
  await deploys.putBuild("acme/api", "dev", { state: "queued", ref: "abc", at: "now" });
  assert.equal(await advance(record, store, 0), BUILD_POLL_MS);
  await deploys.putBuild("acme/api", "dev", { state: "in_progress", ref: "abc", at: "now" });
  assert.equal(await advance(record, store, BUILD_POLL_MS), 2 * BUILD_POLL_MS);
  assert.equal(runs.length, 1);

  await deploys.putBuild("acme/api", "dev", { state: "success", ref: "abc", at: "now" });
  assert.equal(await advance(record, store, 2 * BUILD_POLL_MS), undefined);
  assert.equal(runs.length, 2);
  assert.equal(record.dispatches[0]!.state, "dispatched");
});

test("a dispatch stops waiting for a build that never reports", async () => {
  const { record, store } = await savedRecord(runStore(accepted(), { run: async () => "building" }));
  let now = 0;
  let wake: number | undefined = 0;
  while (wake !== undefined) {
    now = wake;
    wake = await advance(record, store, now);
  }
  assert.equal(now, BUILD_WAIT_MS);
  assert.equal(record.dispatches[0]!.state, "failed");
  assert.match(record.dispatches[0]!.error!, /didn't finish within 3 hours/);
});

test("an error from the deployer fails the dispatch without a retry, since the run may have been queued", async () => {
  const replies: unknown[][] = [];
  const channel = { ...accepted(), reply: async (_thread: unknown, text: string) => void replies.push([text]) };
  const { record, store } = await savedRecord(
    runStore(channel, {
      run: async () => {
        throw new Error("status 502: bad gateway");
      },
    }),
  );
  assert.equal(await advance(record, store, 0), undefined);
  assert.equal(record.dispatches[0]!.state, "failed");
  assert.equal(replies.length, 1);
  assert.deepEqual(failedDelivery(record, 5)?.triggers, [{ trigger: "mention", error: "status 502: bad gateway" }]);
});

test("a failed dispatch takes back the acknowledgment once its notice is posted", async () => {
  const events: string[] = [];
  const channel = {
    ...accepted(),
    reply: async () => void events.push("notice"),
    unacknowledge: async (d: Delivery<FakeEvent>) => void events.push(`unacknowledge ${d.id}`),
  };
  const { record, store } = await savedRecord(runStore(channel, { run: async () => Promise.reject(new Error("refused")) }));
  await advance(record, store, 0);
  assert.deepEqual(events, ["notice", "unacknowledge d1"]);
});

test("each failed trigger of a delivery replaces its own waiting message", async () => {
  const replies: unknown[][] = [];
  let posted = 0;
  const channel = {
    ...accepted(),
    reply: async (_thread: unknown, text: string, message?: string) => {
      replies.push([text, message]);
      return message ?? `w${++posted}`;
    },
  };
  const twoTriggers: OutpostConfig = {
    ...runOutpost,
    triggers: { mention: runOutpost.triggers.mention!, again: runOutpost.triggers.mention! },
  };
  const s: RouterStore = { ...runStore(channel, { run: async () => "building" }), outpost: async () => twoTriggers };
  const { record, store } = await savedRecord(s);
  await advance(record, store, 0);
  assert.equal(replies.length, 2);
  const waiting = Object.fromEntries(record.dispatches.map((d) => [d.trigger, d.waiting]));
  assert.deepEqual(Object.values(waiting).sort(), ["w1", "w2"]);
  store.outpost = async () => ({ ...twoTriggers, triggers: {} });
  await advance(record, store, BUILD_POLL_MS);
  const notices = Object.fromEntries(replies.slice(2).map(([text, message]) => [(text as string).match(/`(\w+)`/)![1], message]));
  assert.deepEqual(notices, waiting);
});

test("a failed dispatch posts its notice without waiting for a sibling that waits for a build", async () => {
  const replies: string[] = [];
  const channel = { ...accepted(), reply: async (_thread: unknown, text: string) => void replies.push(text) };
  const twoTriggers: OutpostConfig = {
    ...runOutpost,
    triggers: { mention: runOutpost.triggers.mention!, other: { ...runOutpost.triggers.mention!, container: "missing" } },
  };
  const s: RouterStore = { ...runStore(channel, { run: async () => "building" }), outpost: async () => twoTriggers };
  const { record, store } = await savedRecord(s);
  assert.equal(await advance(record, store, 0), BUILD_POLL_MS);
  assert.deepEqual(record.dispatches.map((d) => d.state).sort(), ["failed", "pending"]);
  assert.ok(replies.some((text) => text.includes("`other`")));
});

test("a replay dispatches the failed triggers again as new runs, against the outpost config the repo has now", async () => {
  const runs: Run[] = [];
  let ok = false;
  const outposts: Record<string, OutpostConfig> = { "acme/api": runOutpost };
  const s: RouterStore = {
    ...runStore(accepted(), {
      run: async (run) => {
        runs.push(run);
        if (!ok) throw new Error("refused");
        return "queued";
      },
    }),
    outpost: async (repo) => outposts[repo],
  };
  const { record, store } = await savedRecord(s);
  await advance(record, store, 0);
  const failedRun = record.dispatches[0]!.run;
  assert.equal(record.dispatches[0]!.state, "failed");

  ok = true;
  assert.equal(replayRecord(record, "https://router.new"), true);
  await advance(record, store, 1);
  assert.equal(record.dispatches[0]!.state, "dispatched");
  assert.notEqual(runs[1]!.id, failedRun);
  assert.equal(runs[1]!.reply.url, "https://router.new/relay");
  assert.equal(replayRecord(record, "https://router.new"), false);

  // A trigger that the outpost no longer has fails.
  outposts["acme/api"] = { ...runOutpost, triggers: {} };
  record.dispatches[0]!.state = "failed";
  replayRecord(record, "https://router.new");
  await advance(record, store, 2);
  assert.equal(record.dispatches[0]!.state, "failed");
  assert.match(record.dispatches[0]!.error!, /no longer has the trigger `mention`/);
  assert.equal(runs.length, 2);
});

const beat = (s: RouterStore, body: unknown) =>
  handle(new Request("https://router.test/heartbeat", { method: "POST", body: JSON.stringify(body) }), s);

test("a run's ticket names its dispatch, and its heartbeats note the message that its replies replace", async () => {
  const runs: Run[] = [];
  const { record, store, watches } = await savedRecord(runStore(accepted(), { run: async (run) => (runs.push(run), "queued" as const) }));
  await advance(record, store);
  const { reply, id } = runs[0]!;
  assert.equal(reply.heartbeat, "https://router.test/heartbeat");
  assert.equal(reply.ticket.delivery, "d1");
  assert.equal(reply.ticket.run, id);

  const message = { id: "m1", signature: await signMessage(ROOT_KEY, reply.signature, "m1") };
  const response = await beat(store, { ticket: reply.ticket, signature: reply.signature, message });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(watches.get(id), { at: (watches.get(id) as { at: number }).at, message: "m1" });

  // A run can't have the lost notice replace a message that it didn't post.
  const other = { id: "m2", signature: message.signature };
  assert.equal((await beat(store, { ticket: reply.ticket, signature: reply.signature, message: other })).status, 401);
  const forged = { ...reply.ticket, run: "other" };
  assert.equal((await beat(store, { ticket: forged, signature: reply.signature })).status, 401);
  const unnamed = { connection: "fake/main", thread: { repo: "acme/api" }, expires: Date.now() + 60_000 };
  assert.equal((await beat(store, { ticket: unnamed, signature: await signTicket(ROOT_KEY, unnamed) })).status, 400);
  const unknown = { ...reply.ticket, delivery: "other" };
  assert.equal((await beat(store, { ticket: unknown, signature: await signTicket(ROOT_KEY, unknown) })).status, 404);

  assert.equal((await beat(store, { ticket: reply.ticket, signature: reply.signature, done: true })).status, 200);
  assert.deepEqual(watches.get(id), { done: true });
});

test("a heartbeat that arrives after a run's last one doesn't have the router watch the run again", async () => {
  const replies: unknown[][] = [];
  const runs: Run[] = [];
  const channel = { ...accepted(), reply: async (_thread: unknown, text: string) => (replies.push([text]), "n1") };
  const { record, store, watches } = await savedRecord(runStore(channel, { run: async (run) => (runs.push(run), "queued" as const) }));
  await advance(record, store, 0);
  const { reply, id } = runs[0]!;
  assert.equal((await beat(store, { ticket: reply.ticket, signature: reply.signature, done: true })).status, 200);
  assert.equal((await beat(store, { ticket: reply.ticket, signature: reply.signature })).status, 200);
  assert.deepEqual(watches.get(id), { done: true });
  assert.deepEqual(await watch(record, watches, store, Date.now() + LOST_AFTER_MS), { forget: [], next: undefined, lost: false });
  assert.equal(record.dispatches[0]!.state, "dispatched");
  assert.equal(replies.length, 0);
});

test("a run is watched from its first heartbeat, so the router marks lost no run of an outpost that sends none", async () => {
  const replies: unknown[][] = [];
  const channel = { ...accepted(), reply: async (_thread: unknown, text: string, message?: string) => (replies.push([text, message]), "n1") };
  const { record, store, watches } = await savedRecord(runStore(channel, { run: async () => "queued" as const }));
  await advance(record, store, 1_000);
  assert.deepEqual(await watch(record, watches, store, 1_000 + 10 * LOST_AFTER_MS), { forget: [], next: undefined, lost: false });
  assert.equal(record.dispatches[0]!.state, "dispatched");
  assert.equal(replies.length, 0);
});

test("a heartbeat or reply of a run that a restart replaced answers that the run is lost, and posts nothing", async () => {
  const replies: unknown[][] = [];
  const runs: Run[] = [];
  const channel = { ...accepted(), reply: async (_thread: unknown, text: string) => (replies.push([text]), "n1") };
  const { record, store, watches } = await savedRecord(runStore(channel, { run: async (run) => (runs.push(run), "queued" as const) }));
  await advance(record, store, 0);
  const old = runs[0]!;
  watches.set(old.id, { at: 0 });
  await watch(record, watches, store, LOST_AFTER_MS);
  assert.equal(replayRecord(record, ORIGIN, old.id), true);
  await advance(record, store, LOST_AFTER_MS);
  replies.length = 0;

  const response = await beat(store, { ticket: old.reply.ticket, signature: old.reply.signature });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, lost: true });
  const refused = await relay(store, { ticket: old.reply.ticket, signature: old.reply.signature, text: "late" });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).lost, true);
  assert.equal(replies.length, 0);

  const current = runs[1]!;
  assert.equal((await relay(store, { ticket: current.reply.ticket, signature: current.reply.signature, text: "working" })).status, 200);
  assert.deepEqual(replies, [["working"]]);
});

test("a reply of a lost run posts nothing, so it doesn't replace the lost notice", async () => {
  const replies: unknown[][] = [];
  const runs: Run[] = [];
  const channel = { ...accepted(), reply: async (_thread: unknown, text: string) => (replies.push([text]), "n1") };
  const { record, store, watches } = await savedRecord(runStore(channel, { run: async (run) => (runs.push(run), "queued" as const) }));
  await advance(record, store, 0);
  const { reply, id } = runs[0]!;
  watches.set(id, { at: 0 });
  await watch(record, watches, store, LOST_AFTER_MS);
  assert.equal(replies.length, 1);
  const refused = await relay(store, { ticket: reply.ticket, signature: reply.signature, text: "done", done: true });
  assert.equal(refused.status, 409);
  assert.equal(replies.length, 1);
  assert.equal(record.dispatches[0]!.state, "lost");
});

test("a run's last reply takes back the acknowledgment, and a reply before it doesn't", async () => {
  const events: string[] = [];
  const runs: Run[] = [];
  const channel = {
    ...accepted(),
    reply: async (_thread: unknown, text: string) => (events.push(text), "n1"),
    unacknowledge: async (d: Delivery<FakeEvent>) => void events.push(`unacknowledge ${d.id}`),
  };
  const { record, store } = await savedRecord(runStore(channel, { run: async (run) => (runs.push(run), "queued" as const) }));
  await advance(record, store, 0);
  const { reply } = runs[0]!;
  assert.equal((await relay(store, { ticket: reply.ticket, signature: reply.signature, text: "working" })).status, 200);
  assert.equal((await relay(store, { ticket: reply.ticket, signature: reply.signature, text: "done", done: true })).status, 200);
  assert.deepEqual(events, ["working", "done", "unacknowledge d1"]);
});

test("a run's last reply stops the router watching it, once the reply is posted", async () => {
  const replies: unknown[][] = [];
  const runs: Run[] = [];
  let failing = true;
  const channel = {
    ...accepted(),
    reply: async (_thread: unknown, text: string) => {
      if (failing) throw new Error("GitHub is down");
      replies.push([text]);
      return "n1";
    },
  };
  const { record, store, watches } = await savedRecord(runStore(channel, { run: async (run) => (runs.push(run), "queued" as const) }));
  await advance(record, store, 0);
  const { reply, id } = runs[0]!;
  assert.equal((await beat(store, { ticket: reply.ticket, signature: reply.signature })).status, 200);

  // A last reply that fails leaves the run watched, so the lost notice replaces the run's message.
  await assert.rejects(relay(store, { ticket: reply.ticket, signature: reply.signature, text: "done", done: true }), /GitHub is down/);
  assert.equal("done" in watches.get(id)!, false);

  failing = false;
  assert.equal((await relay(store, { ticket: reply.ticket, signature: reply.signature, text: "done", done: true })).status, 200);
  assert.deepEqual(watches.get(id), { done: true });
  assert.deepEqual(await watch(record, watches, store, Date.now() + LOST_AFTER_MS), { forget: [], next: undefined, lost: false });
  assert.equal(record.dispatches[0]!.state, "dispatched");
  assert.deepEqual(replies, [["done"]]);
});

test("a run without a heartbeat for 5 minutes is marked lost, and the lost notice replaces its message", async () => {
  const replies: unknown[][] = [];
  const runs: Run[] = [];
  const channel = {
    ...accepted(),
    reply: async (_thread: unknown, text: string, message?: string) => (replies.push([text, message]), message ?? "n1"),
  };
  const { record, store, watches } = await savedRecord(runStore(channel, { run: async (run) => (runs.push(run), "queued" as const) }));
  await advance(record, store, 0);
  const run = runs[0]!.id;
  watches.set(run, { at: 1_000, message: "m1" });

  assert.deepEqual(await watch(record, watches, store, 1_000 + LOST_AFTER_MS - 1), { forget: [], next: 1_000 + LOST_AFTER_MS, lost: false });
  assert.equal(record.dispatches[0]!.state, "dispatched");

  assert.deepEqual(await watch(record, watches, store, 1_000 + LOST_AFTER_MS), { forget: [run], next: undefined, lost: true });
  assert.equal(record.dispatches[0]!.state, "lost");
  assert.equal(replies.length, 1);
  assert.equal(replies[0]![1], "m1");
  assert.match(replies[0]![0] as string, /^This run sent no heartbeat for 5 minutes, so Factory marked it as lost\./);
  const link = new URL((replies[0]![0] as string).match(/\[Restart the run\]\((.+?)\)/)![1]!);
  assert.equal(`${link.origin}${link.pathname}`, "https://router.test/restart");
  assert.equal(replies[0]![0], lostNotice(link.toString()));
  assert.equal(record.dispatches[0]!.waiting, "m1");
  assert.deepEqual(failedDelivery(record, 2)?.triggers, [{ trigger: "mention", error: LOST_ERROR }]);
  assert.equal(await store.inbox.heartbeat("fake/main", "d1", run, {}), "lost");

  // The run that replaces a lost one replaces the lost notice.
  assert.equal(replayRecord(record, ORIGIN), true);
  await advance(record, store, 3);
  assert.equal(record.dispatches[0]!.state, "dispatched");
  assert.equal(runs[1]!.reply.message?.id, "m1");
});

const open = async (s: RouterStore, url: string) => {
  const response = await handle(new Request(url), s);
  return { status: response.status, location: response.headers.get("location"), text: await response.text() };
};

test("a lost run's restart link signs the person in, checks them against the trigger's from, and restarts only that run", async () => {
  const replies: string[] = [];
  const runs: Run[] = [];
  const channel = {
    ...accepted(),
    reply: async (_thread: unknown, text: string, message?: string) => (replies.push(text), message ?? "n1"),
  };
  const { record, store, watches } = await savedRecord(runStore(channel, { run: async (run) => (runs.push(run), "queued" as const) }));
  await advance(record, store, 0);
  const lost = runs[0]!.id;
  watches.set(lost, { at: Date.now() - LOST_AFTER_MS });
  await watch(record, watches, store);
  const link = replies[0]!.match(/\[Restart the run\]\((.+?)\)/)![1]!;
  const token = new URL(link).searchParams.get("run")!;

  const signIn = await open(store, link);
  assert.equal(signIn.status, 302);
  const location = new URL(signIn.location!);
  assert.equal(location.searchParams.get("state"), token);
  assert.equal(location.searchParams.get("redirect"), "https://router.test/restart/callback");

  const callback = (code: string, state = token) =>
    open(store, `https://router.test/restart/callback?code=${code}&state=${encodeURIComponent(state)}`);
  const denied = await callback("code-bob-2");
  assert.equal(denied.status, 403);
  assert.match(denied.text, /bob may not trigger this agent/);
  assert.equal(record.dispatches[0]!.state, "lost");

  // A link can't be changed to restart another run, or used after it expires.
  const signature = token.slice(token.lastIndexOf(".") + 1);
  const other = await signRestart(ROOT_KEY, { connection: "fake/main", delivery: "d1", run: crypto.randomUUID(), expires: Date.now() + 1000 });
  assert.equal((await callback("code-alice-1", `${other.slice(0, other.lastIndexOf("."))}.${signature}`)).status, 401);
  assert.equal((await open(store, `https://router.test/restart?run=${encodeURIComponent(`${token}0`)}`)).status, 401);
  const expired = await signRestart(ROOT_KEY, { connection: "fake/main", delivery: "d1", run: lost, expires: Date.now() - 1 });
  assert.equal((await callback("code-alice-1", expired)).status, 401);

  // The callback redirects, so reloading the page that says the run restarted doesn't send the code again.
  const restarted = await callback("code-alice-1");
  assert.equal(restarted.status, 303);
  assert.equal(restarted.location, "https://router.test/restart/started");
  const started = await open(store, restarted.location!);
  assert.equal(started.status, 200);
  assert.match(started.text, /The run is starting again/);
  assert.equal(record.dispatches[0]!.state, "pending");
  await advance(record, store, 1);
  assert.notEqual(runs[1]!.id, lost);
  assert.equal(runs[1]!.reply.message?.id, "n1");

  assert.equal((await callback("code-alice-1")).status, 409);
  // A link to a run that isn't lost any more says so before it sends the person to sign in.
  const again = await open(store, link);
  assert.equal(again.status, 409);
  assert.match(again.text, /isn't lost any more/);
});

test("the record that an alarm saves keeps a restart that was saved while the alarm waited on a channel", async () => {
  const record: DeliveryRecord = {
    id: "d1",
    connection: "fake/main",
    delivery: { id: "d1", scope: "acme/api", repo: "acme/api", event: "post", data: {}, payload: {} },
    origin: ORIGIN,
    received: 0,
    acknowledged: true,
    dispatches: [
      { trigger: "a", run: "r1", state: "dispatched" },
      { trigger: "b", run: "r2", state: "lost", error: LOST_ERROR },
    ],
  };
  const read = record.dispatches.map((d) => JSON.stringify(d));
  const stored = structuredClone(record);
  // The alarm marks the first run lost, while the person restarts the second.
  Object.assign(record.dispatches[0]!, { state: "lost", error: LOST_ERROR });
  assert.equal(replayRecord(stored, "https://router.new", "r2"), true);
  const saved = mergeRecord(read, record, stored);
  assert.deepEqual(saved.dispatches.map((d) => d.state), ["lost", "pending"]);
  assert.notEqual(saved.dispatches[1]!.run, "r2");
  assert.equal(saved.origin, "https://router.new");
  assert.equal(nextTry(saved, 5), 5);
});

test("watching forgets runs that the record no longer has or that failed, and leaves runs that aren't dispatched yet", async () => {
  const { record, store } = await savedRecord(runStore(accepted(), {}));
  const watches = new Map<string, Watch>([
    [record.dispatches[0]!.run, { at: 0 }],
    ["gone", { at: 0 }],
  ]);
  assert.deepEqual(await watch(record, watches, store, LOST_AFTER_MS), { forget: ["gone"], next: LOST_AFTER_MS, lost: false });
  assert.equal(record.dispatches[0]!.state, "pending");
  record.dispatches[0]!.state = "failed";
  assert.deepEqual(await watch(record, watches, store, LOST_AFTER_MS), { forget: [record.dispatches[0]!.run, "gone"], next: undefined, lost: false });
});

const adminStore = (channel: RemoteChannel<FakeEvent>, calls: string[] = []): RouterStore => ({
  ...sourceStore(channel, calls),
  config: {
    // Operator auth signs in through a connection of its own provider.
    connections: { "fake/main": entry("CHANNEL_MAIN"), "github/main": { ...entry("CHANNEL_MAIN"), provider: "github" } },
    codeHost: { provider: "fake", connection: "main", allow: [{ owner: "acme" }] },
    operators: { provider: "github", connection: "main", users: ["Alice"] },
  },
  channel: (binding) => (binding === "CHANNEL_MAIN" ? (channel as RemoteChannel) : undefined),
});

const adminCall = async (s: RouterStore, method: string, path: string, { body, session }: { body?: unknown; session?: string } = {}) => {
  const response = await handle(
    new Request(`https://router.test${path}`, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body) }),
      ...(session && { headers: { authorization: `Bearer ${session}` } }),
    }),
    s,
  );
  return { status: response.status, body: await response.json() };
};

const adminChannel = () => sourceChannel([], []);

test("an operator signs in through the operator auth's channel, and gets a session that the admin routes take", async () => {
  const s = adminStore(adminChannel());
  const signIn = await adminCall(s, "POST", "/admin/sign-in", { body: { state: "s1" } });
  assert.equal(signIn.status, 200);
  assert.equal(signIn.body.url, "https://sign-in.test/?state=s1");
  assert.equal((await adminCall(s, "POST", "/admin/sign-in")).status, 400);

  const signed = await adminCall(s, "POST", "/admin/session", { body: { code: "code-alice-1" } });
  assert.equal(signed.status, 200);
  assert.equal(signed.body.operator, "alice");
  assert.ok(signed.body.expires > Date.now());
  assert.equal((await verifySession(ROOT_KEY, signed.body.session))?.login, "alice");
  assert.equal(signed.body.session.split(".").slice(0, 3).join("."), `alice.1.${signed.body.expires}`);
  // A token whose operator or expiry is changed fails its signature.
  assert.equal(await verifySession(ROOT_KEY, signed.body.session.replace(/^alice\.1\.\d+/, `alice.1.${signed.body.expires + 1}`)), undefined);
  assert.equal(await verifySession(ROOT_KEY, signed.body.session.replace(/^alice\.1\./, "alice.2.")), undefined);

  assert.equal((await adminCall(s, "GET", "/admin/deliveries", { session: signed.body.session })).status, 200);
  assert.equal((await adminCall(s, "GET", "/admin/deliveries")).status, 401);
  assert.equal((await adminCall(s, "GET", "/admin/deliveries", { session: `${signed.body.session}0` })).status, 401);
});

test("a sign-in by someone outside the operator auth gets no session", async () => {
  const s = adminStore(adminChannel());
  const { status, body } = await adminCall(s, "POST", "/admin/session", { body: { code: "code-mallory" } });
  assert.equal(status, 403);
  assert.equal(body.session, undefined);
});

test("an operator listed by account id signs in under any login, and a login of digits is not an id", async () => {
  const s = adminStore(adminChannel());
  s.config.operators = { provider: "github", connection: "main", users: [7, "8"] };
  assert.equal((await adminCall(s, "POST", "/admin/session", { body: { code: "code-renamed-7" } })).status, 200);
  assert.equal((await adminCall(s, "POST", "/admin/session", { body: { code: "code-mallory-8" } })).status, 403);
  // A session keeps working after its operator's rename, since the id still matches.
  const session = await signSession(ROOT_KEY, { login: "old-name", id: "7", expires: Date.now() + 60_000 });
  assert.equal((await adminCall(s, "GET", "/admin/deliveries", { session })).status, 200);
});

test("a session keeps a login with dots in it", async () => {
  const session = await signSession(ROOT_KEY, { login: "a.b", id: "1.5", expires: Date.now() + 60_000 });
  assert.equal(session.split(".").length, 4);
  const found = await verifySession(ROOT_KEY, session);
  assert.equal(found?.login, "a.b");
  assert.equal(found?.id, "1.5");
});

test("a session stops working when it expires, or when its operator leaves the operator auth", async () => {
  const s = adminStore(adminChannel());
  const expired = await signSession(ROOT_KEY, { login: "alice", id: "1", expires: Date.now() - 1 });
  assert.equal((await adminCall(s, "GET", "/admin/deliveries", { session: expired })).status, 401);
  const session = await signSession(ROOT_KEY, { login: "alice", id: "1", expires: Date.now() + 60_000 });
  s.config.operators = { provider: "github", connection: "main", users: ["bob"] };
  assert.equal((await adminCall(s, "GET", "/admin/deliveries", { session })).status, 401);
});

test("a deploy is logged with a queued build for each container it builds, and build reports update the build", async () => {
  const calls: string[] = [];
  const deploys = memoryDeploys();
  await deploys.putBuild("acme/api", "ci", { state: "success", ref: "old", at: "then" });
  const s: RouterStore = { ...sourceStore(sourceChannel([{ repo: "acme/api", ref: "abc" }], calls), calls), deploys };
  s.deployer!.deploy = async (_repo, source) => ({ state: "deployed", ref: source.ref, at: "now", builds: ["dev"] });
  await call(s);
  assert.deepEqual(await deploys.list(), [
    {
      repo: "acme/api",
      status: { state: "deployed", ref: "abc", at: "now", builds: ["dev"] },
      // A container that this deploy didn't build keeps its last build.
      builds: { ci: { state: "success", ref: "old", at: "then" }, dev: { state: "queued", ref: "abc", at: "now" } },
    },
  ]);

  const report = { repo: "acme/api", ref: "abc", container: "dev", state: "success" as const, url: "https://dash.test/b", expires: Date.now() + 60_000 };
  await buildReport(s, { report, signature: await signBuildReport(ROOT_KEY, report) });
  const build = (await deploys.build("acme/api", "dev"))!;
  assert.equal(build.state, "success");
  assert.equal(build.url, "https://dash.test/b");
});

test("a late report of an older commit's build doesn't replace the newer build in the log", async () => {
  const deploys = memoryDeploys();
  const s: RouterStore = { ...sourceStore(sourceChannel([], []), []), deploys };
  await deploys.putBuild("acme/api", "dev", { state: "queued", ref: "new", at: "now" });
  const old = { repo: "acme/api", ref: "old", container: "dev", state: "failure" as const, expires: Date.now() + 60_000 };
  assert.equal((await buildReport(s, { report: old, signature: await signBuildReport(ROOT_KEY, old) })).status, 200);
  assert.deepEqual(await deploys.build("acme/api", "dev"), { state: "queued", ref: "new", at: "now" });

  const current = { ...old, ref: "new", state: "success" as const };
  await buildReport(s, { report: current, signature: await signBuildReport(ROOT_KEY, current) });
  assert.equal((await deploys.build("acme/api", "dev"))?.state, "success");
  await buildReport(s, { report: old, signature: await signBuildReport(ROOT_KEY, old) });
  assert.equal((await deploys.build("acme/api", "dev"))?.state, "success");
});

test("a deploy drops the logged builds of containers that the outpost no longer has", async () => {
  const deploys = memoryDeploys();
  await deploys.putBuild("acme/api", "ci", { state: "success", ref: "old", at: "then" });
  await deploys.putBuild("acme/api", "gone", { state: "success", ref: "old", at: "then" });
  const s: RouterStore = { ...sourceStore(sourceChannel([{ repo: "acme/api", ref: "abc" }], []), []), deploys };
  s.outpost = async () => ({ ...runOutpost, containers: { ci: runOutpost.containers.dev! } });
  await call(s);
  assert.deepEqual(Object.keys((await deploys.list())[0]!.builds), ["ci"]);
});

test("repos lists each repo's last deploy with its builds", async () => {
  const deploys = memoryDeploys();
  await deploys.put("acme/web", { state: "failed", error: "bad", at: "then" });
  await deploys.put("acme/api", { state: "deployed", ref: "abc", at: "now" });
  await deploys.putBuild("acme/api", "dev", { state: "success", ref: "abc", at: "now" });
  const s: RouterStore = { ...adminStore(adminChannel()), deploys };
  const session = await signSession(ROOT_KEY, { login: "alice", id: "1", expires: Date.now() + 60_000 });
  const { status, body } = await adminCall(s, "GET", "/admin/repos", { session });
  assert.equal(status, 200);
  assert.deepEqual(body.repos.map((r: RepoDeploy) => [r.repo, Object.keys(r.builds)]), [
    ["acme/api", ["dev"]],
    ["acme/web", []],
  ]);
});

test("sync deploys every repo that the code host can read and allows, one at a time, and removes the outposts of the others", async () => {
  const calls: string[] = [];
  const deploys = memoryDeploys();
  await deploys.put("acme/gone", { state: "deployed", at: "then" });
  const channel = sourceChannel([], calls);
  channel.repos = async () => ["acme/api", "other/api"];
  const s: RouterStore = { ...sourceStore(channel, calls), deploys, syncKey: async () => SYNC_KEY };
  const { status } = await syncCall(s, await signSync(SYNC_KEY, ORIGIN));
  assert.equal(status, 200);
  assert.deepEqual(calls.sort(), ["deploy acme/api head", "read acme/api .factory undefined", "remove acme/gone", "status acme/api deployed"]);
  assert.deepEqual([...deploys.saved.keys()], ["acme/api"]);
});

test("sync hands the repos' deploys to the store's queue, where it has one", async () => {
  const calls: string[] = [];
  const queued: unknown[] = [];
  const channel = sourceChannel([], calls);
  channel.repos = async () => ["acme/api"];
  const s: RouterStore = { ...sourceStore(channel, calls), syncKey: async () => SYNC_KEY, queueDeploys: async (changes) => void queued.push(changes) };
  assert.equal((await syncCall(s, await signSync(SYNC_KEY, ORIGIN))).status, 200);
  assert.deepEqual(queued, [[{ repo: "acme/api" }]]);
  assert.deepEqual(calls, []);
});

test("sync answers before the repos' deploys finish, where the platform allows it", async () => {
  const calls: string[] = [];
  const tasks: Promise<unknown>[] = [];
  const channel = sourceChannel([], calls);
  channel.repos = async () => ["acme/api"];
  const s: RouterStore = { ...sourceStore(channel, calls), syncKey: async () => SYNC_KEY, background: (task) => void tasks.push(task) };
  assert.equal((await syncCall(s, await signSync(SYNC_KEY, ORIGIN))).status, 200);
  assert.equal(tasks.length, 1);
  await tasks[0];
  assert.ok(calls.includes("deploy acme/api head"));
});

test("replay replays one failed delivery, or all of them, against the router's origin", async () => {
  const replays: string[] = [];
  const inbox: Inbox = {
    receive: async () => true,
    failed: async () => [
      { connection: "fake/main", id: "d1", repo: "acme/api", event: "post", received: 1, failed: 2, triggers: [] },
      { connection: "fake/main", id: "d2", repo: "acme/api", event: "post", received: 1, failed: 2, triggers: [] },
    ],
    replay: async (connection, id, origin) => (replays.push(`${connection}/${id} ${origin}`), id === "d1"),
    heartbeat: async () => "unknown",
    record: async () => undefined,
    restart: async () => false,
  };
  const s: RouterStore = { ...adminStore(adminChannel()), inbox };
  const session = await signSession(ROOT_KEY, { login: "alice", id: "1", expires: Date.now() + 60_000 });
  const one = await adminCall(s, "POST", "/admin/replay", { session, body: { connection: "fake/main", id: "d1" } });
  assert.deepEqual(one.body, { replayed: [{ connection: "fake/main", id: "d1" }], skipped: [] });
  const all = await adminCall(s, "POST", "/admin/replay", { session, body: {} });
  assert.deepEqual(all.body, { replayed: [{ connection: "fake/main", id: "d1" }], skipped: [{ connection: "fake/main", id: "d2" }] });
  assert.deepEqual(replays, ["fake/main/d1 https://router.test", "fake/main/d1 https://router.test", "fake/main/d2 https://router.test"]);
  assert.equal((await adminCall(s, "POST", "/admin/replay", { session, body: { id: "d1" } })).status, 400);
});
