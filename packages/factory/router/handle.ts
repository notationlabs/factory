import type { OutpostConfig, TriggerEntry } from "../contracts/outpost.ts";
import type { RepoPattern, RouterConfig } from "../contracts/router.ts";
import { allowsRepo } from "../lib/repos.ts";
import type {
  AuthorCheck,
  BuildCheck,
  Delivery,
  FactoryStatus,
  RemoteChannel,
  SourceChange,
  SourceFiles,
} from "./channel.ts";
import {
  type DeliveryRecord,
  failureNotice,
  type Inbox,
  RETRY_FOR_MS,
  retryDelay,
  settled,
  type TriggerDispatch,
  waitingNotice,
} from "./deliveries.ts";
import {
  type BuildReportRequest,
  isBranchName,
  type MessagesRequest,
  type MessagesResult,
  type Relay,
  type RelayResult,
  REPLY_TTL_MS,
  type Run,
  type RunResult,
  signMessage,
  signTicket,
  signTokenTicket,
  type TokenRequest,
  type Tokens,
  verifyBuildReport,
  verifyMessage,
  verifyTicket,
  verifyTokenTicket,
} from "./run.ts";

/** The KV key that the deployer stores a repo's outpost config under. `repo` is `owner/name`. */
export const outpostKey = (repo: string) => `outposts/${repo.toLowerCase()}`;

/** Where the router reads its state, and finds each connection's channel. Each platform adapts its own storage to it. */
export type RouterStore = {
  config: Partial<RouterConfig>;
  /** The channel that the router reaches by `binding`, the name in a connection's entry. */
  channel(binding: string): RemoteChannel | undefined;
  outpost(repo: string): Promise<OutpostConfig | undefined>;
  deployer?: RemoteDeployer;
  /** The root key, which the router derives its own keys from. */
  rootKey(): Promise<string>;
  /** Keeps `task` running after the response, where the platform allows it. Without it, the router waits for the task. */
  background?(task: Promise<unknown>): void;
  /**
   * Where the router saves deliveries, which retries their dispatch and
   * keeps the failed ones. Without it, the router tries each dispatch once,
   * and keeps nothing.
   */
  inbox?: Inbox;
};

/** The deployer, as the router calls it. */
export type RemoteDeployer = {
  /** Evaluates the repo's `.factory/` files and stores its outpost config. Resolves to the status to show on the repo. */
  deploy(repo: string, source: SourceFiles): Promise<FactoryStatus>;
  /** Removes the repo's outpost config. */
  remove(repo: string): Promise<void>;
  /** Calls the worktree function of the repo's trigger with `payload`, in the isolate that evaluates configs. */
  worktree(repo: string, trigger: string, payload: unknown): Promise<string | undefined>;
  /** Hands `run` to its container, which queues it. */
  run(run: Run): Promise<RunResult>;
};

/** The name of the check that shows the build of a container's image, such as `factory/build dev`. */
export const buildCheckName = (container: string) => `factory/build ${container}`;

/** The directory of a repo that holds its outpost's files. */
export const FACTORY_DIR = ".factory";

/** A trigger that a delivery matched. `run` is the id of the run it started, if its author may start one. */
export type TriggerMatch = { trigger: string; author: AuthorCheck; run?: string };

/** The path that a connection's platform delivers to. `key` is the connection's key, such as `github/gh`. */
export const webhookPath = (key: string) => `/webhook/${key}`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** The connections whose channel the router can reach, by key. */
const channels = (store: RouterStore) =>
  Object.entries(store.config.connections ?? {}).flatMap(([key, entry]) => {
    const channel = entry.channel && store.channel(entry.channel);
    return channel ? [{ key, entry, channel }] : [];
  });

/**
 * Handles a delivery to a connection's webhook path:
 * 1. Finds the connection's channel.
 * 2. Has the channel verify and parse the delivery.
 * 3. Reads the outpost of the delivery's repo, and matches the triggers on
 *    channels of the delivery's connection and scope.
 * 4. If any match's author may start a run, saves the delivery to the
 *    inbox before it answers, and the inbox dispatches it with `advance`.
 *    A delivery whose connection and id the inbox has seen is a duplicate,
 *    and starts nothing. Without an inbox, the router dispatches it at once.
 */
const webhook = async (request: Request, key: string, store: RouterStore) => {
  const found = channels(store).find((c) => c.key === key);
  if (!found) return json(404, { error: `no channel for connection ${key}` });
  const { entry, channel } = found;
  const name = key.slice(entry.provider.length + 1);

  const received = await channel.receive(request);
  if (received.status === "rejected") return json(401, { error: received.reason });
  if (received.status === "ignored") return json(200, { ignored: received.reason });
  if (received.status === "source") {
    return source(key, received.changes, channel, store);
  }

  const { delivery } = received;
  const summary = { delivery: delivery.id, connection: key, event: delivery.event, scope: delivery.scope };
  const outpost = await store.outpost(delivery.repo);
  if (!outpost) return json(202, { ...summary, ignored: "no outpost" });

  const matches: TriggerMatch[] = [];
  const dispatches: TriggerDispatch[] = [];
  for (const [id, trigger] of Object.entries(outpost.triggers ?? {})) {
    if (!listens(outpost, trigger, entry.provider, name, delivery)) continue;
    const author = await channel.match(trigger.match, delivery);
    if (!author) continue;
    // Team checks need a call to the platform, which the router doesn't make yet.
    if (author.result !== "allowed") {
      matches.push({ trigger: id, author });
      continue;
    }
    const run = crypto.randomUUID();
    matches.push({ trigger: id, author, run });
    dispatches.push({ trigger: id, run, state: "pending", attempts: 0 });
  }
  if (dispatches.length) {
    const record: DeliveryRecord = {
      id: delivery.id || crypto.randomUUID(),
      connection: key,
      delivery,
      origin: new URL(request.url).origin,
      received: Date.now(),
      dispatches,
    };
    if (store.inbox) {
      if (!(await store.inbox.receive(record))) {
        const result = { ...summary, duplicate: true };
        console.log(JSON.stringify(result));
        return json(200, result);
      }
    } else {
      const task = advance(record, store).catch((error) =>
        console.error(JSON.stringify({ delivery: delivery.id, error: message(error) })),
      );
      if (store.background) store.background(task);
      else await task;
    }
  }
  const result = { ...summary, matches };
  console.log(JSON.stringify(result));
  return json(202, result);
};

/** Whether `trigger` listens on a channel of the delivery's connection and scope, for the delivery's event. `name` is the connection's name. */
const listens = (outpost: OutpostConfig, trigger: TriggerEntry, provider: string, name: string, delivery: Delivery<unknown>) => {
  const target = outpost.channels?.[trigger.channel];
  return (
    trigger.event === delivery.event &&
    target?.provider === provider &&
    target.connection === name &&
    target.scope === delivery.scope
  );
};

/**
 * Tries a saved delivery's dispatches that are due, and resolves to when
 * to call it again, if any dispatch is left to try. It changes `record`,
 * which the caller saves:
 * 1. Has the channel show on the delivery's post that a run is starting,
 *    once.
 * 2. Reads the repo's outpost config as it is now, and dispatches each due
 *    trigger with new tokens.
 * 3. With an inbox, a dispatch whose container didn't take the run, or
 *    whose image is still building, is tried again after a wait, for
 *    `RETRY_FOR_MS`. The thread shows that the run is waiting.
 * 4. Once no dispatch is left, posts one message to the thread if any
 *    failed. With an inbox, it says that the event was kept for replay.
 */
export const advance = async (record: DeliveryRecord, store: RouterStore, now = Date.now()): Promise<{ wake?: number }> => {
  const kept = Boolean(store.inbox);
  const found = channels(store).find((c) => c.key === record.connection);
  const due = record.dispatches.filter((d) => d.state === "pending" && (d.next ?? 0) <= now);
  if (!found) {
    for (const d of due) Object.assign(d, { state: "failed", error: `The hub has no channel for connection ${record.connection}.` });
  } else if (due.length) {
    const { entry, channel } = found;
    if (!record.acknowledged) {
      await channel.acknowledge(record.delivery).catch((error) =>
        console.error(JSON.stringify({ delivery: record.id, state: "acknowledge failed", error: message(error) })),
      );
      record.acknowledged = true;
    }
    const outpost = await store.outpost(record.delivery.repo);
    const name = record.connection.slice(entry.provider.length + 1);
    await Promise.all(
      due.map(async (d) => {
        const attempt = await dispatch(
          { dispatch: d, key: record.connection, provider: entry.provider, name, channel, delivery: record.delivery, outpost, origin: record.origin },
          store,
        ).catch((error): Attempt => ({ ok: false, retryable: false, error: message(error) }));
        await settle(d, attempt, channel, kept, now);
      }),
    );
  }
  if (!settled(record)) {
    return { wake: Math.min(...record.dispatches.filter((d) => d.state === "pending").map((d) => d.next ?? now)) };
  }
  const failed = record.dispatches.filter((d) => d.state === "failed");
  if (failed.length && !record.noticed && found) {
    const target = failed.find((d) => d.waiting?.message) ?? failed.find((d) => d.thread !== undefined);
    if (target) {
      await found.channel
        .reply(target.thread, failureNotice(failed, kept), target.waiting?.message)
        .catch((error) => console.error(JSON.stringify({ delivery: record.id, state: "notice failed", error: message(error) })));
    }
  }
  record.noticed = true;
  return {};
};

/** Records the outcome of one attempt of a dispatch, and has the thread show that a retried run is waiting. */
const settle = async (d: TriggerDispatch, attempt: Attempt, channel: RemoteChannel, kept: boolean, now: number) => {
  if (attempt.thread !== undefined) d.thread = attempt.thread;
  if (attempt.ok) {
    d.state = "dispatched";
    delete d.next;
    delete d.error;
    return;
  }
  d.error = attempt.error;
  d.attempts += 1;
  d.since ??= now;
  console.error(JSON.stringify({ run: d.run, trigger: d.trigger, attempt: d.attempts, retryable: attempt.retryable, error: attempt.error }));
  if (kept && attempt.retryable && now - d.since < RETRY_FOR_MS) {
    d.next = now + retryDelay(d.attempts);
    if (!d.waiting && d.thread !== undefined && attempt.container) {
      try {
        const id = await channel.reply(d.thread, waitingNotice(attempt.container, Boolean(attempt.building)));
        d.waiting = typeof id === "string" ? { message: id } : {};
      } catch (error) {
        console.error(JSON.stringify({ run: d.run, state: "waiting notice failed", error: message(error) }));
      }
    }
    return;
  }
  d.state = "failed";
  delete d.next;
};

/** The outcome of one attempt of a dispatch. A failure names the thread and container, if the attempt got that far. */
type Attempt = ({ ok: true } | { ok: false; error: string; retryable: boolean; building?: boolean }) & {
  thread?: unknown;
  container?: string;
};

type Dispatch = {
  dispatch: TriggerDispatch;
  /** The delivery's connection, and its provider and name. */
  key: string;
  provider: string;
  name: string;
  channel: RemoteChannel;
  delivery: Delivery<unknown>;
  /** The repo's outpost config as it is now. */
  outpost: OutpostConfig | undefined;
  /** The router's origin, which the runner replies to. */
  origin: string;
};

/** The channel of the code host's connection, which mints repo tokens. */
const codeHostChannel = (store: RouterStore) => {
  const codeHost = store.config.codeHost;
  if (!codeHost) return undefined;
  const key = `${codeHost.provider}/${codeHost.connection}`;
  return { provider: codeHost.provider, channel: channels(store).find((c) => c.key === key)?.channel };
};

/** Has the code host's channel mint a token for each of the container's code host policies. */
const mintTokens = async (store: RouterStore, outpost: OutpostConfig, repo: string, container: string) => {
  const codeHost = codeHostChannel(store);
  if (!codeHost?.channel) throw new Error("The hub has no code host whose channel mints tokens.");
  const entry = outpost.containers[container];
  if (!entry) throw new Error(`The outpost has no container ${container}.`);
  const tokens: Tokens = [];
  for (const policy of entry.policies) {
    const policyEntry = outpost.policies[policy];
    if (!policyEntry) throw new Error(`The outpost has no policy ${policy}.`);
    // Policies of other providers aren't minted yet.
    if (policyEntry.provider !== codeHost.provider) continue;
    const target = typeof policyEntry.repo === "string" ? policyEntry.repo : repo;
    const permissions = policyEntry.permissions as Record<string, "read" | "write">;
    tokens.push({ policy, repo: target, token: await codeHost.channel.token(target, permissions) });
  }
  return tokens;
};

/**
 * Starts one run of a matched trigger:
 * 1. Checks that the outpost still has the trigger, and that it still
 *    matches the delivery and its author. Has the delivery's channel name
 *    the conversation, and signs a ticket for reading and replying to its
 *    thread. The run's first reply replaces the thread's waiting message,
 *    if there is one.
 * 2. Has the deployer call the trigger's worktree function, if it has one.
 * 3. Has the code host's channel mint a read-only token for the clone, and a
 *    token for each of the container's code host policies. Signs a ticket
 *    for new tokens.
 * 4. Hands the run to the deployer. An error thrown over RPC means the
 *    deployer couldn't be reached, which is worth retrying.
 */
const dispatch = async (d: Dispatch, store: RouterStore): Promise<Attempt> => {
  const { delivery, outpost } = d;
  const { trigger: triggerId, run: runId, waiting } = d.dispatch;
  const repo = delivery.repo;
  const trigger = outpost?.triggers?.[triggerId];
  if (!outpost || !trigger) {
    return { ok: false, retryable: false, error: `The outpost of ${repo} no longer has the trigger \`${triggerId}\`.` };
  }
  if (
    !listens(outpost, trigger, d.provider, d.name, delivery) ||
    (await d.channel.match(trigger.match, delivery))?.result !== "allowed"
  ) {
    return { ok: false, retryable: false, error: `The trigger \`${triggerId}\` no longer matches the event.` };
  }
  const conversation = await d.channel.conversation(delivery, { selector: trigger.match, agent: trigger.agent });
  const ticket = { connection: d.key, thread: conversation.thread, expires: Date.now() + REPLY_TTL_MS };
  const rootKey = await store.rootKey();
  const signature = await signTicket(rootKey, ticket);
  const reply: Run["reply"] = { url: `${d.origin}/relay`, ticket, signature };
  if (waiting?.message) reply.message = { id: waiting.message, signature: await signMessage(rootKey, signature, waiting.message) };
  const failed = { thread: conversation.thread, container: trigger.container };
  try {
    const { deployer } = store;
    if (!deployer) throw new Error("The hub has no deployer.");
    const container = outpost.containers[trigger.container];
    const agent = outpost.agents[trigger.agent];
    if (!container) throw new Error(`The outpost has no container ${trigger.container}.`);
    if (!agent) throw new Error(`The outpost has no agent ${trigger.agent}.`);
    const codeHost = codeHostChannel(store);
    if (!codeHost?.channel) throw new Error("The hub has no code host whose channel mints tokens.");

    let worktree: Run["worktree"];
    if (trigger.worktree) {
      const branch = await deployer.worktree(repo, triggerId, delivery.payload);
      if (branch !== undefined) {
        if (typeof branch !== "string" || !isBranchName(branch)) {
          throw new Error(`The worktree function of ${triggerId} returned ${JSON.stringify(branch)}, which isn't a branch name the runner can check out.`);
        }
        worktree = { branch, ...(trigger.worktree.base && { base: trigger.worktree.base }) };
      }
    }

    const tokens = await mintTokens(store, outpost, repo, trigger.container);
    const tokenTicket = { repo, container: trigger.container, expires: Date.now() + REPLY_TTL_MS };
    const refresh = { url: `${d.origin}/tokens`, ticket: tokenTicket, signature: await signTokenTicket(rootKey, tokenTicket) };

    const result = await deployer.run({
      id: runId,
      repo,
      trigger: triggerId,
      container: trigger.container,
      runtimes: container.runtimes,
      files: container.files ?? {},
      agent: { id: trigger.agent, ...agent },
      conversation: {
        id: conversation.id,
        ...(conversation.message && { message: conversation.message }),
        ...(conversation.event && { event: conversation.event }),
        ...(conversation.channel && { channel: conversation.channel }),
        ...(conversation.context && { context: conversation.context }),
      },
      ...(worktree && { worktree }),
      cloneToken: await codeHost.channel.token(repo, { contents: "read" }),
      tokens,
      refresh,
      reply,
    }).catch((error): RunResult => ({ ok: false, retryable: true, error: message(error) }));
    if (!result.ok) return { ...result, ...failed };
    console.log(JSON.stringify({ run: runId, repo, trigger: triggerId, container: trigger.container, worktree }));
    return { ok: true, thread: conversation.thread };
  } catch (error) {
    return { ok: false, retryable: false, error: message(error), ...failed };
  }
};

/**
 * Reads a body that carries a reply ticket, checks the ticket's signature,
 * and finds the channel of the ticket's connection. Returns a response
 * instead if any step fails.
 */
const ticketed = async <T extends MessagesRequest>(request: Request, store: RouterStore) => {
  let body: T;
  try {
    body = (await request.json()) as T;
  } catch {
    return json(400, { error: "the body isn't JSON" });
  }
  const { ticket, signature } = body ?? {};
  if (!ticket || typeof signature !== "string") return json(400, { error: "the body needs ticket and signature" });
  const rootKey = await store.rootKey();
  if (!(await verifyTicket(rootKey, ticket, signature))) {
    return json(401, { error: "bad or expired ticket" });
  }
  const found = channels(store).find((c) => c.key === ticket.connection);
  if (!found) return json(404, { error: `no channel for connection ${ticket.connection}` });
  return { body, rootKey, channel: found.channel };
};

/** Posts a container's reply, if the router signed its ticket, through the channel of the ticket's connection. */
const relay = async (request: Request, store: RouterStore) => {
  const found = await ticketed<Relay>(request, store);
  if (found instanceof Response) return found;
  const { body, rootKey, channel } = found;
  const { ticket, signature, text, message } = body;
  if (typeof text !== "string") return json(400, { error: "the body needs text" });
  if (message !== undefined && (typeof message?.id !== "string" || typeof message.signature !== "string")) {
    return json(400, { error: "the message needs id and signature" });
  }
  if (message && !(await verifyMessage(rootKey, signature, message))) {
    return json(401, { error: "bad message signature" });
  }
  const id = await channel.reply(ticket.thread, text, message?.id);
  const result: RelayResult = { ok: true };
  if (typeof id === "string") result.message = { id, signature: await signMessage(rootKey, signature, id) };
  return json(200, result);
};

/**
 * Answers a run's thread's messages, if the router signed its reply ticket.
 * The runner builds the agent's prompt from them when the run starts.
 */
const messages = async (request: Request, store: RouterStore) => {
  const found = await ticketed<MessagesRequest>(request, store);
  if (found instanceof Response) return found;
  try {
    const result: MessagesResult = { messages: await found.channel.messages(found.body.ticket.thread) };
    return json(200, result);
  } catch (error) {
    return json(502, { error: message(error) });
  }
};

/**
 * Mints a container's policy tokens again, if the router signed the
 * ticket. The tokens follow the outpost config that the repo has now.
 */
const tokens = async (request: Request, store: RouterStore) => {
  let body: TokenRequest;
  try {
    body = (await request.json()) as TokenRequest;
  } catch {
    return json(400, { error: "the body isn't JSON" });
  }
  const { ticket, signature } = body ?? {};
  if (!ticket || typeof signature !== "string") return json(400, { error: "the body needs ticket and signature" });
  if (!(await verifyTokenTicket(await store.rootKey(), ticket, signature))) {
    return json(401, { error: "bad or expired ticket" });
  }
  const outpost = await store.outpost(ticket.repo);
  if (!outpost) return json(404, { error: `${ticket.repo} has no outpost` });
  if (!outpost.containers[ticket.container]) return json(404, { error: `the outpost has no container ${ticket.container}` });
  try {
    return json(200, await mintTokens(store, outpost, ticket.repo, ticket.container));
  } catch (error) {
    return json(502, { error: message(error) });
  }
};

/** Shows a container image's build on the commit it was built from, through the code host's channel. */
const builds = async (request: Request, store: RouterStore) => {
  let body: BuildReportRequest;
  try {
    body = (await request.json()) as BuildReportRequest;
  } catch {
    return json(400, { error: "the body isn't JSON" });
  }
  const { report, signature } = body ?? {};
  if (!report || typeof signature !== "string") return json(400, { error: "the body needs report and signature" });
  if (!(await verifyBuildReport(await store.rootKey(), report, signature))) {
    return json(401, { error: "bad or expired signature" });
  }
  const channel = codeHostChannel(store)?.channel;
  if (!channel) return json(404, { error: "the hub has no code host" });
  const { repo, ref, container, state, url, summary } = report;
  try {
    await channel.writeCheck(repo, ref, { name: buildCheckName(container), state, ...(url && { url }), ...(summary && { summary }) });
  } catch (error) {
    return json(502, { error: message(error) });
  }
  return json(200, { ok: true });
};

/** Writes a check, and logs a failure instead of throwing it. The App may not have the checks permission yet. */
const writeCheck = async (channel: RemoteChannel, repo: string, ref: string, check: BuildCheck) => {
  try {
    await channel.writeCheck(repo, ref, check);
  } catch (error) {
    console.error(JSON.stringify({ repo, ref, check: check.name, error: message(error) }));
  }
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Deploys one repo's outpost again:
 * 1. A repo that the hub can no longer read, or that the code host doesn't
 *    allow, loses its outpost.
 * 2. Otherwise the channel reads `.factory/`, and the deployer evaluates and
 *    stores it.
 * 3. The channel shows the outcome on the repo, and a queued check on the
 *    commit for each container whose image started building. The deployer
 *    reports each build's progress to `/builds`.
 */
const redeploy = async (
  change: SourceChange,
  allow: RepoPattern[],
  channel: RemoteChannel,
  deployer: RemoteDeployer,
) => {
  const { repo, ref } = change;
  if (change.removed) return deployer.remove(repo);
  const at = () => new Date().toISOString();
  let status: FactoryStatus;
  if (!allowsRepo(allow, repo)) {
    await deployer.remove(repo);
    status = { state: "failed", error: `The hub doesn't serve ${repo}: the code host's allow list doesn't include it.`, at: at() };
  } else {
    try {
      status = await deployer.deploy(repo, await channel.read(repo, FACTORY_DIR, ref));
    } catch (error) {
      status = { state: "failed", ref, error: message(error), at: at() };
    }
  }
  await channel.writeStatus(repo, status);
  for (const container of status.builds ?? []) {
    if (status.ref) await writeCheck(channel, repo, status.ref, { name: buildCheckName(container), state: "queued" });
  }
  console.log(JSON.stringify({ repo, ...status }));
};

/** Deploys the outposts of the repos a delivery changed. Only the code host's connection reads repos. */
const source = async (
  key: string,
  changes: SourceChange[],
  channel: RemoteChannel,
  store: RouterStore,
) => {
  const codeHost = store.config.codeHost;
  if (!codeHost || `${codeHost.provider}/${codeHost.connection}` !== key) {
    return json(200, { ignored: "not the code host's connection" });
  }
  const { deployer } = store;
  if (!deployer) return json(200, { ignored: "no deployer" });
  const task = (async () => {
    for (const change of changes) {
      try {
        await redeploy(change, codeHost.allow ?? [], channel, deployer);
      } catch (error) {
        console.error(JSON.stringify({ repo: change.repo, error: message(error) }));
      }
    }
  })();
  if (store.background) store.background(task);
  else await task;
  return json(202, { connection: key, deploying: changes.map((c) => c.repo) });
};

/** Has each connection's channel set up its platform side, pointing it at this router. */
const sync = async (request: Request, store: RouterStore) => {
  const { origin } = new URL(request.url);
  const results: Record<string, string> = {};
  for (const { key, channel } of channels(store)) {
    try {
      await channel.sync(`${origin}${webhookPath(key)}`);
      results[key] = "ok";
    } catch (error) {
      results[key] = error instanceof Error ? error.message : String(error);
    }
  }
  const failed = Object.values(results).some((r) => r !== "ok");
  return json(failed ? 502 : 200, { connections: results });
};

/**
 * The router's routes. `POST /sync` needs no auth, because a channel's sync
 * only sets the values the router derives. `POST /relay`, `POST /messages`
 * and `POST /tokens` take tickets that the router signed when it started a
 * run. `POST /builds` takes reports that the deployer signed.
 */
export const handle = (request: Request, store: RouterStore) => {
  const { pathname } = new URL(request.url);
  if (request.method === "POST" && pathname.startsWith("/webhook/")) {
    return webhook(request, pathname.slice("/webhook/".length), store);
  }
  if (request.method === "POST" && pathname === "/relay") {
    return relay(request, store);
  }
  if (request.method === "POST" && pathname === "/messages") {
    return messages(request, store);
  }
  if (request.method === "POST" && pathname === "/tokens") {
    return tokens(request, store);
  }
  if (request.method === "POST" && pathname === "/builds") {
    return builds(request, store);
  }
  if (request.method === "POST" && pathname === "/sync") {
    return sync(request, store);
  }
  return Promise.resolve(json(404, { error: "not found" }));
};
