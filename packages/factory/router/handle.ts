import type { OutpostConfig, TriggerEntry } from "../contracts/outpost.ts";
import type { RepoPattern, RouterConfig } from "../contracts/router.ts";
import { allowsRepo } from "../lib/repos.ts";
import {
  type ContainerBuild,
  type DeliveriesResult,
  type DeployLog,
  isOperator,
  type ReplayRequest,
  type ReplayResult,
  type ReposResult,
  SESSION_TTL_MS,
  type SessionRequest,
  type SessionResult,
  type SignInRequest,
  type SignInResult,
  signSession,
  verifySession,
} from "./admin.ts";
import type {
  AuthorCheck,
  BuildCheck,
  Delivery,
  FactoryStatus,
  Operator,
  RemoteChannel,
  SourceChange,
  SourceFiles,
} from "./channel.ts";
import {
  BUILD_POLL_MS,
  BUILD_WAIT_MS,
  type DeliveryRecord,
  failureNotice,
  type Inbox,
  isLost,
  KEEP_DELIVERY_MS,
  LOST_ERROR,
  lostNotice,
  nextTry,
  restartingNotice,
  type TriggerDispatch,
  waitingNotice,
  type Watch,
} from "./deliveries.ts";
import {
  type BuildReportRequest,
  type Heartbeat,
  type HeartbeatResult,
  isBranchName,
  LOST_AFTER_MS,
  type MessagesRequest,
  type MessagesResult,
  type Relay,
  type RelayResult,
  REPLY_TTL_MS,
  type RestartTicket,
  type Run,
  type RunResult,
  signMessage,
  signRestart,
  signTicket,
  signTokenTicket,
  type TokenRequest,
  type Tokens,
  verifyBuildReport,
  verifyMessage,
  verifyRestart,
  verifyTicket,
  verifyTokenTicket,
} from "./run.ts";
import { SYNC_HEADER, verifySync } from "./sync.ts";

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
  /** The key that deploy signs `POST /sync` with. Without it, the router refuses every sync. */
  syncKey?(): Promise<string | undefined>;
  /** Keeps `task` running after the response, where the platform allows it. Without it, the router waits for the task. */
  background?(task: Promise<unknown>): void;
  /** Where the router saves deliveries, which dispatches them and keeps the failed ones. */
  inbox: Inbox;
  /** Where the router keeps each repo's last deploy. Without it, operators can't list deploys. */
  deploys?: DeployLog;
  /**
   * Deploys each change with `redeployRepo`, one at a time, until all are
   * done, without the time limit of a request. A new call replaces the
   * changes that are left. Without it, a sync deploys the repos in the
   * background.
   */
  queueDeploys?(changes: SourceChange[]): Promise<void>;
};

/** The deployer, as the router calls it. */
export type RemoteDeployer = {
  /** Evaluates the repo's `.factory/` files and stores its outpost config. Resolves to the status to show on the repo. */
  deploy(repo: string, source: SourceFiles): Promise<FactoryStatus>;
  /** Removes the repo's outpost config. */
  remove(repo: string): Promise<void>;
  /** Calls the worktree function of the repo's trigger with `payload`, in the isolate that evaluates configs. */
  worktree(repo: string, trigger: string, payload: unknown): Promise<string | undefined>;
  /** Hands `run` to its container, which queues it. Throws if the container refuses it or doesn't answer. */
  run(run: Run): Promise<RunResult>;
};

/** The name of the check that shows the build of a container's image, such as `factory/build dev`. */
export const buildCheckName = (container: string) => `factory/build ${container}`;

/** The directory of a repo that holds its outpost's files. */
export const FACTORY_DIR = ".factory";

/** A trigger that a delivery matched. `run` is the id of the run it started, if its author may start one. */
export type TriggerMatch = { trigger: string; author: AuthorCheck; run?: string };

/** The router's page that a lost run's restart link opens. */
export const RESTART_PATH = "/restart";

/** The router's page that the sign-in of a restart link sends the browser back to. A code host's App must allow it as a redirect URL. */
export const RESTART_CALLBACK_PATH = "/restart/callback";

/** The router's page that says a run is starting again. The callback redirects to it, so reloading the page doesn't send GitHub's code again. */
const RESTARTED_PATH = "/restart/started";

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
 *    and starts nothing.
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
  const selectors = selectorsOf(outpost, entry.provider, delivery);
  for (const [id, trigger] of Object.entries(outpost.triggers ?? {})) {
    if (!listens(outpost, trigger, entry.provider, name, delivery)) continue;
    const author = await channel.match(trigger.match, delivery, selectors);
    if (!author) continue;
    // Team checks need a call to the platform, which the router doesn't make yet.
    if (author.result !== "allowed") {
      matches.push({ trigger: id, author });
      continue;
    }
    const run = crypto.randomUUID();
    matches.push({ trigger: id, author, run });
    dispatches.push({ trigger: id, run, state: "pending" });
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
    if (!(await store.inbox.receive(record))) {
      const result = { ...summary, duplicate: true };
      console.log(JSON.stringify(result));
      return json(200, result);
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

/** The selectors of the outpost's triggers on any of the provider's connections with the delivery's scope, for any event. */
const selectorsOf = (outpost: OutpostConfig, provider: string, delivery: Delivery<unknown>) =>
  Object.values(outpost.triggers ?? {})
    .filter((t) => {
      const target = outpost.channels?.[t.channel];
      return target?.provider === provider && target.scope === delivery.scope;
    })
    .map((t) => t.match);

/**
 * Tries a saved delivery's dispatches that are due, and resolves to when
 * to call it again, if any dispatch is left to try. It changes `record`,
 * which the caller saves:
 * 1. Reads the repo's outpost config as it is now.
 * 2. Has the channel show on the delivery's post that a run is starting,
 *    once. It passes the channel the selectors of the delivery's triggers,
 *    as the outpost has them now.
 *    Then it dispatches each due trigger with new tokens.
 * 3. A dispatch whose container's first image build hasn't finished waits
 *    for it. See `waitForBuild`. It isn't tried again while the deploy log
 *    says the build is queued or in progress, so it doesn't mint tokens
 *    for nothing.
 * 4. Posts a notice to the thread of each dispatch that fails, if the
 *    dispatch got as far as naming the conversation, and then has the
 *    channel show that the delivery's post is answered.
 */
export const advance = async (record: DeliveryRecord, store: RouterStore, now = Date.now()): Promise<number | undefined> => {
  const due = record.dispatches.filter((d) => d.state === "pending" && (d.next ?? 0) <= now);
  const found = channels(store).find((c) => c.key === record.connection);
  if (due.length && !found) {
    for (const d of due) Object.assign(d, { state: "failed", error: `The hub has no channel for connection ${record.connection}.` });
  } else if (due.length && found) {
    const { entry, channel } = found;
    const outpost = await store.outpost(record.delivery.repo);
    if (!record.acknowledged) {
      const selectors = record.dispatches.flatMap((d) => {
        const trigger = outpost?.triggers?.[d.trigger];
        return trigger ? [trigger.match] : [];
      });
      await channel.acknowledge(record.delivery, selectors).catch((error) =>
        console.error(JSON.stringify({ delivery: record.id, state: "acknowledge failed", error: message(error) })),
      );
      record.acknowledged = true;
    }
    const name = record.connection.slice(entry.provider.length + 1);
    const repo = record.delivery.repo;
    await Promise.all(
      due.map(async (d) => {
        try {
          const waitingFor = d.since !== undefined ? outpost?.triggers?.[d.trigger]?.container : undefined;
          if (waitingFor && (await isBuilding(store, repo, waitingFor))) {
            await waitForBuild(d, waitingFor, repo, channel, store, now);
            return;
          }
          const building = await dispatch(
            {
              dispatch: d,
              id: record.id,
              key: record.connection,
              provider: entry.provider,
              name,
              channel,
              delivery: record.delivery,
              outpost,
              origin: record.origin,
            },
            store,
          );
          if (building) await waitForBuild(d, building, repo, channel, store, now);
          else d.state = "dispatched";
        } catch (error) {
          Object.assign(d, { state: "failed", error: message(error) });
          console.error(JSON.stringify({ run: d.run, trigger: d.trigger, error: d.error }));
          if (d.thread === undefined) return;
          try {
            await channel.reply(d.thread, failureNotice(d), d.waiting);
          } catch (error) {
            console.error(JSON.stringify({ run: d.run, state: "notice failed", error: message(error) }));
            return;
          }
          await answered(channel, record.delivery, d.run);
        }
      }),
    );
  }
  return nextTry(record, now);
};

const isBuilding = async (store: RouterStore, repo: string, container: string) => {
  const state = (await store.deploys?.build(repo, container))?.state;
  return state === "queued" || state === "in_progress";
};

/**
 * Has a dispatch wait for its container's first image build, and try again
 * in `BUILD_POLL_MS`. The first time, it posts the waiting message to the
 * thread. Throws if the repo's last deploy says the build failed, or the
 * dispatch has waited `BUILD_WAIT_MS`.
 */
const waitForBuild = async (
  d: TriggerDispatch,
  container: string,
  repo: string,
  channel: RemoteChannel,
  store: RouterStore,
  now: number,
) => {
  const build = await store.deploys?.build(repo, container);
  if (build?.state === "failure" || build?.state === "cancelled") {
    const outcome = build.state === "failure" ? "failed" : "was cancelled";
    const details = [build.summary, build.url && `The build's log: ${build.url}`].filter(Boolean).join(" ");
    throw new Error(`The first image build of container \`${container}\` ${outcome}.${details ? ` ${details}` : ""}`);
  }
  if (d.since !== undefined && now - d.since >= BUILD_WAIT_MS) {
    throw new Error(`The first image build of container \`${container}\` didn't finish within ${BUILD_WAIT_MS / 3_600_000} hours.`);
  }
  d.next = now + BUILD_POLL_MS;
  if (d.since !== undefined) return;
  d.since = now;
  try {
    d.waiting = await channel.reply(d.thread, waitingNotice(container));
  } catch (error) {
    console.error(JSON.stringify({ run: d.run, state: "waiting notice failed", error: message(error) }));
  }
};

/**
 * Marks lost each dispatched run of the record whose last heartbeat in
 * `watches` is `LOST_AFTER_MS` old, and posts the lost notice in place of
 * the run's message. A run is watched from its first heartbeat, which the
 * outpost posts as soon as it takes the run, so the router doesn't mark
 * lost the runs of an outpost that sends no heartbeats. The notice has a
 * restart link, signed for the run, which works for `KEEP_DELIVERY_MS`, as
 * long as the inbox keeps the delivery. It changes `record`, which the
 * caller saves, and resolves to the runs to stop watching, to when to check
 * the others again, and to whether it marked a run lost.
 */
export const watch = async (record: DeliveryRecord, watches: Map<string, Watch>, store: RouterStore, now = Date.now()) => {
  const forget: string[] = [];
  let next: number | undefined;
  let lost = false;
  const channel = channels(store).find((c) => c.key === record.connection)?.channel;
  for (const [run, beat] of watches) {
    const d = record.dispatches.find((d) => d.run === run);
    if (!d || d.state === "failed" || d.state === "lost") {
      forget.push(run);
      continue;
    }
    if ("done" in beat) continue;
    const due = beat.at + LOST_AFTER_MS;
    if (d.state !== "dispatched" || due > now) {
      next = Math.min(next ?? due, due);
      continue;
    }
    Object.assign(d, { state: "lost", error: LOST_ERROR });
    forget.push(run);
    lost = true;
    console.error(JSON.stringify({ run, trigger: d.trigger, state: "lost", heartbeat: beat.at }));
    if (!channel || d.thread === undefined) continue;
    try {
      const ticket = { connection: record.connection, delivery: record.id, run, expires: now + KEEP_DELIVERY_MS };
      const link = `${record.origin}${RESTART_PATH}?run=${encodeURIComponent(await signRestart(await store.rootKey(), ticket))}`;
      const posted = await channel.reply(d.thread, lostNotice(link), beat.message ?? d.waiting);
      if (posted !== undefined) d.waiting = posted;
    } catch (error) {
      console.error(JSON.stringify({ run, state: "lost notice failed", error: message(error) }));
    }
  }
  return { forget, next, lost };
};

type Dispatch = {
  dispatch: TriggerDispatch;
  /** The delivery's id in the inbox. */
  id: string;
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
 * Starts one run of a matched trigger, and resolves to the run's container
 * if its first image build hasn't finished. Throws if the run can't start.
 * 1. Checks that the outpost still has the trigger, and that it still
 *    matches the delivery and its author. Has the delivery's channel name
 *    the conversation, and signs a ticket for reading and replying to its
 *    thread, and for the run's heartbeats. The run's first reply replaces
 *    the thread's waiting message, if there is one.
 * 2. Has the deployer call the trigger's worktree function, if it has one.
 * 3. Has the code host's channel mint a read-only token for the clone, and a
 *    token for each of the container's code host policies. Signs a ticket
 *    for new tokens.
 * 4. Hands the run to the deployer.
 */
const dispatch = async (d: Dispatch, store: RouterStore): Promise<string | undefined> => {
  const { delivery, outpost } = d;
  const { trigger: triggerId, run: runId, waiting } = d.dispatch;
  const repo = delivery.repo;
  const trigger = outpost?.triggers?.[triggerId];
  if (!outpost || !trigger) throw new Error(`The outpost of ${repo} no longer has the trigger \`${triggerId}\`.`);
  if (
    !listens(outpost, trigger, d.provider, d.name, delivery) ||
    (await d.channel.match(trigger.match, delivery, selectorsOf(outpost, d.provider, delivery)))?.result !== "allowed"
  ) {
    throw new Error(`The trigger \`${triggerId}\` no longer matches the event.`);
  }
  const conversation = await d.channel.conversation(delivery, { selector: trigger.match, agent: trigger.agent });
  d.dispatch.thread = conversation.thread;
  const ticket = { connection: d.key, thread: conversation.thread, delivery: d.id, run: runId, expires: Date.now() + REPLY_TTL_MS };
  const rootKey = await store.rootKey();
  const signature = await signTicket(rootKey, ticket);
  const reply: Run["reply"] = { url: `${d.origin}/relay`, ticket, signature, heartbeat: `${d.origin}/heartbeat` };
  if (waiting) reply.message = { id: waiting, signature: await signMessage(rootKey, signature, waiting) };
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
  });
  if (result === "building") return trigger.container;
  console.log(JSON.stringify({ run: runId, repo, trigger: triggerId, container: trigger.container, worktree }));
  return undefined;
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

/** Has the channel show that a delivery's post is answered. A failure is only logged. */
const answered = (channel: RemoteChannel, delivery: Delivery<unknown>, run: string) =>
  channel
    .answered(delivery)
    .catch((error) => console.error(JSON.stringify({ run, state: "answered failed", error: message(error) })));

/**
 * Posts a container's reply, if the router signed its ticket, through the
 * channel of the ticket's connection. For a ticket that names a run:
 * 1. Answers 409 with `lost`, and posts nothing, if the run is lost, so a
 *    run that comes back doesn't replace the lost notice.
 * 2. With `done`, stops watching the run once the reply is posted, and has
 *    the channel show that the delivery's post is answered. A reply that
 *    fails leaves the run watched, so the lost notice replaces the run's
 *    last message.
 * 3. Without `done`, counts the reply as a heartbeat that names the posted
 *    message, if a heartbeat started watching the run. A run that stops
 *    before its next heartbeat then still has its last reply replaced by
 *    the lost notice.
 */
const relay = async (request: Request, store: RouterStore) => {
  const found = await ticketed<Relay>(request, store);
  if (found instanceof Response) return found;
  const { body, rootKey, channel } = found;
  const { ticket, signature, text, message, done } = body;
  const { delivery, run } = ticket;
  if (typeof text !== "string") return json(400, { error: "the body needs text" });
  if (message !== undefined && (typeof message?.id !== "string" || typeof message.signature !== "string")) {
    return json(400, { error: "the message needs id and signature" });
  }
  if (message && !(await verifyMessage(rootKey, signature, message))) {
    return json(401, { error: "bad message signature" });
  }
  const named = typeof delivery === "string" && typeof run === "string";
  const record = named ? await store.inbox.record(ticket.connection, delivery) : undefined;
  if (named && isLost(record, run)) {
    return json(409, { error: "the router marked the run lost", lost: true });
  }
  const id = await channel.reply(ticket.thread, text, message?.id);
  const beat = done === true ? { done: true } : typeof id === "string" ? { message: id, reply: true } : undefined;
  if (named && beat) {
    // The reply is posted, so answer 200 even if the heartbeat or the answered call fails.
    await store.inbox.heartbeat(ticket.connection, delivery, run, beat).catch((error) => {
      console.error(JSON.stringify({ run, relay: "heartbeat failed", error: String(error) }));
    });
    if (done === true && record) await answered(channel, record.delivery, run);
  }
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
 * Notes a run's heartbeat in the inbox, if the router signed its reply
 * ticket for a run. Answers `lost` if the run is lost, such as when a
 * restart replaced it with a new run.
 */
const heartbeat = async (request: Request, store: RouterStore) => {
  const found = await ticketed<Heartbeat>(request, store);
  if (found instanceof Response) return found;
  const { body, rootKey } = found;
  const { ticket, signature, message: posted, done } = body;
  if (typeof ticket.delivery !== "string" || typeof ticket.run !== "string") {
    return json(400, { error: "the ticket names no run" });
  }
  if (posted !== undefined && (typeof posted?.id !== "string" || typeof posted.signature !== "string")) {
    return json(400, { error: "the message needs id and signature" });
  }
  if (posted && !(await verifyMessage(rootKey, signature, posted))) {
    return json(401, { error: "bad message signature" });
  }
  const result = await store.inbox.heartbeat(ticket.connection, ticket.delivery, ticket.run, {
    ...(posted && { message: posted.id }),
    ...(done === true && { done: true }),
  });
  if (result === "unknown") return json(404, { error: "the inbox has no such run" });
  const answer: HeartbeatResult = { ok: true, ...(result === "lost" && { lost: true }) };
  return json(200, answer);
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

/**
 * Shows a container image's build on the commit it was built from, through
 * the code host's channel, and logs it as the container's latest build
 * unless the log has a build of another commit.
 */
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
  const build: ContainerBuild = { state, ref, ...(url && { url }), ...(summary && { summary }), at: new Date().toISOString() };
  await logBuild(store, repo, container, build).catch((error) =>
    console.error(JSON.stringify({ repo, container, state: "build log failed", error: message(error) })),
  );
  try {
    await channel.writeCheck(repo, ref, { name: buildCheckName(container), state, ...(url && { url }), ...(summary && { summary }) });
  } catch (error) {
    return json(502, { error: message(error) });
  }
  return json(200, { ok: true });
};

const logBuild = async (store: RouterStore, repo: string, container: string, build: ContainerBuild) => {
  const latest = await store.deploys?.build(repo, container);
  // A deploy logs each build it starts as queued, after the builds before it.
  // So a report for another commit is a late report of an older build.
  if (latest && latest.ref !== build.ref) return;
  await store.deploys?.putBuild(repo, container, build);
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
 * 4. After a deploy that succeeds, the log drops the builds of containers
 *    that the outpost no longer has.
 */
const redeploy = async (
  change: SourceChange,
  allow: RepoPattern[],
  channel: RemoteChannel,
  deployer: RemoteDeployer,
  store: RouterStore,
) => {
  const { repo, ref } = change;
  const log = store.deploys;
  if (change.removed) {
    await deployer.remove(repo);
    await log?.remove(repo);
    return;
  }
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
  await log?.put(repo, status);
  await channel.writeStatus(repo, status);
  for (const container of status.builds ?? []) {
    if (!status.ref) continue;
    await log?.putBuild(repo, container, { state: "queued", ref: status.ref, at: status.at });
    await writeCheck(channel, repo, status.ref, { name: buildCheckName(container), state: "queued" });
  }
  if (log && status.state === "deployed") {
    const outpost = await store.outpost(repo);
    if (outpost) await log.pruneBuilds(repo, Object.keys(outpost.containers));
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
  await later(store, redeployEach(changes, codeHost.allow ?? [], channel, deployer, store));
  return json(202, { connection: key, deploying: changes.map((c) => c.repo) });
};

/** Runs `task` after the response where the platform allows it, or else waits for it. */
const later = async (store: RouterStore, task: Promise<void>) => {
  if (store.background) store.background(task);
  else await task;
};

/** Deploys each change one at a time. */
const redeployEach = async (
  changes: SourceChange[],
  allow: RepoPattern[],
  channel: RemoteChannel,
  deployer: RemoteDeployer,
  store: RouterStore,
) => {
  for (const change of changes) {
    try {
      await redeploy(change, allow, channel, deployer, store);
    } catch (error) {
      console.error(JSON.stringify({ repo: change.repo, error: message(error) }));
    }
  }
};

/** Deploys one repo's outpost again, as a source change through the code host's channel would. Logs an error instead of throwing it. */
export const redeployRepo = async (change: SourceChange, store: RouterStore) => {
  const codeHost = store.config.codeHost;
  const channel = codeHostChannel(store)?.channel;
  const { deployer } = store;
  if (!codeHost || !channel || !deployer) return;
  await redeployEach([change], codeHost.allow ?? [], channel, deployer, store);
};

/**
 * Deploys every repo again:
 * 1. Has the code host's channel list the repos that the hub can read, and
 *    keeps those that the code host's allow list includes.
 * 2. Deploys each of them again from its default branch, one at a time,
 *    through `queueDeploys` if the store has it.
 * 3. Removes the outposts of the other deployed repos.
 */
const syncRepos = async (store: RouterStore) => {
  const codeHost = store.config.codeHost;
  const channel = codeHostChannel(store)?.channel;
  const { deployer } = store;
  if (!codeHost || !channel || !deployer) return;
  const allow = codeHost.allow ?? [];
  const deploying = (await channel.repos()).filter((repo) => allowsRepo(allow, repo));
  const kept = new Set(deploying.map((repo) => repo.toLowerCase()));
  const deployed = (await store.deploys?.repos()) ?? [];
  const removing = deployed.filter((repo) => !kept.has(repo.toLowerCase()));
  console.log(JSON.stringify({ sync: { deploying, removing } }));
  const changes: SourceChange[] = [...deploying.map((repo) => ({ repo })), ...removing.map((repo) => ({ repo, removed: true }))];
  if (store.queueDeploys) await store.queueDeploys(changes);
  else await redeployEach(changes, allow, channel, deployer, store);
};

/**
 * Handles the sync that deploy sends after it deploys the hub:
 * 1. Checks that the request was signed with the sync key.
 * 2. Has each connection's channel set up its platform side, pointing it
 *    at this router, and answers with each one's outcome.
 * 3. Deploys every repo again with `syncRepos`, after the response.
 */
const sync = async (request: Request, store: RouterStore) => {
  const syncKey = await store.syncKey?.();
  if (!syncKey) return json(501, { error: "the router has no sync key" });
  const { origin } = new URL(request.url);
  if (!(await verifySync(syncKey, request.headers.get(SYNC_HEADER) ?? "", origin))) {
    return json(401, { error: "the sync request isn't signed with the sync key" });
  }
  const results: Record<string, string> = {};
  for (const { key, channel } of channels(store)) {
    try {
      await channel.sync(`${origin}${webhookPath(key)}`);
      results[key] = "ok";
    } catch (error) {
      results[key] = error instanceof Error ? error.message : String(error);
    }
  }
  await later(
    store,
    syncRepos(store).catch((error) => console.error(JSON.stringify({ sync: "failed", error: message(error) }))),
  );
  const failed = Object.values(results).some((r) => r !== "ok");
  return json(failed ? 502 : 200, { connections: results });
};

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** A page for a person's browser, with one paragraph of text. */
const page = (status: number, text: string) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>Notation Factory</title><p>${escapeHtml(text)}</p>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

/** The ticket of a restart link's token, and the channel of its connection, or a page that says why there's none. */
const restartTicket = async (token: string, store: RouterStore) => {
  const ticket = token ? await verifyRestart(await store.rootKey(), token) : undefined;
  if (!ticket) return page(401, "This restart link isn't valid, or it has expired.");
  const channel = channels(store).find((c) => c.key === ticket.connection)?.channel;
  if (!channel) return page(404, `The hub has no channel for connection ${ticket.connection}.`);
  return { ticket, channel };
};

/** The delivery of a restart link's ticket, and its dispatch, if that dispatch is still the lost run. */
const lostRun = async (ticket: RestartTicket, store: RouterStore) => {
  const record = await store.inbox.record(ticket.connection, ticket.delivery);
  const dispatch = record?.dispatches.find((d) => d.run === ticket.run);
  return record && dispatch?.state === "lost" ? { record, dispatch } : undefined;
};

const NOT_LOST = "This run isn't lost any more. Someone may have restarted it already.";

/**
 * Sends the browser to the sign-in page of the lost run's channel, which
 * sends it to the callback with the link's token as the state, if the run
 * is still lost.
 */
const restartLink = async (request: Request, store: RouterStore) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("run") ?? "";
  const found = await restartTicket(token, store);
  if (found instanceof Response) return found;
  if (!(await lostRun(found.ticket, store))) return page(409, NOT_LOST);
  try {
    const location = await found.channel.signInUrl(token, `${url.origin}${RESTART_CALLBACK_PATH}`);
    return new Response(null, { status: 302, headers: { location } });
  } catch (error) {
    return page(502, `Factory couldn't start the sign-in: ${message(error)}`);
  }
};

/**
 * Restarts a lost run for the person who signed in:
 * 1. Checks the restart link's token, which comes back as the sign-in's state.
 * 2. Has the channel of the token's connection sign the person in with the code.
 * 3. Finds the lost run in the inbox, and its trigger in the outpost config
 *    that the repo has now.
 * 4. Has the channel check that the trigger's `from` lets the person start a run.
 * 5. Replaces the lost notice with a notice that says the person restarted
 *    the run, so the thread shows it when the browser gets there.
 * 6. Has the inbox dispatch the run again, as a new run, and redirects the
 *    browser to the delivery's post, or to a page that says so if the
 *    delivery has no `url`.
 */
const restartCallback = async (request: Request, store: RouterStore) => {
  const url = new URL(request.url);
  const found = await restartTicket(url.searchParams.get("state") ?? "", store);
  if (found instanceof Response) return found;
  const { ticket, channel } = found;
  const code = url.searchParams.get("code");
  if (!code) return page(400, "The sign-in returned no code.");
  let person: Operator;
  try {
    person = await channel.signIn(code, `${url.origin}${RESTART_CALLBACK_PATH}`);
  } catch (error) {
    return page(401, `Signing in failed: ${message(error)}`);
  }
  const lost = await lostRun(ticket, store);
  if (!lost) return page(409, NOT_LOST);
  const { record, dispatch } = lost;
  const trigger = (await store.outpost(record.delivery.repo))?.triggers?.[dispatch.trigger];
  if (!trigger) return page(404, `The outpost of ${record.delivery.repo} no longer has the trigger ${dispatch.trigger}.`);
  let allowed: boolean;
  try {
    allowed = await channel.canTrigger(trigger.match, record.delivery, person);
  } catch (error) {
    return page(502, `Factory couldn't check who may trigger the agent: ${message(error)}`);
  }
  if (!allowed) return page(403, `${person.login} may not trigger this agent, so the run wasn't restarted.`);
  // Posted before the restart, so the new run's first reply can't be replaced by it.
  if (dispatch.thread !== undefined) {
    await channel.reply(dispatch.thread, restartingNotice(person.login), dispatch.waiting).catch((error) => {
      console.error(JSON.stringify({ run: ticket.run, state: "restarting notice failed", error: message(error) }));
    });
  }
  if (!(await store.inbox.restart(ticket.connection, ticket.delivery, ticket.run, url.origin))) return page(409, NOT_LOST);
  console.log(JSON.stringify({ run: ticket.run, delivery: ticket.delivery, state: "restarted", by: person.login, id: person.id }));
  const location = record.delivery.url ?? `${url.origin}${RESTARTED_PATH}`;
  return new Response(null, { status: 303, headers: { location } });
};

/** Reads a JSON object body, or answers 400. */
const readJson = async <T>(request: Request): Promise<T | Response> => {
  try {
    const body = (await request.json()) as T;
    if (body && typeof body === "object") return body;
  } catch {}
  return json(400, { error: "the body isn't a JSON object" });
};

/** The channel that signs operators in, for an operator auth that signs in through a connection's platform. */
const signInChannel = (store: RouterStore) => {
  const operators = store.config.operators;
  if (!operators) return json(404, { error: "the hub has no operator auth" });
  // Only GitHub sign-in is built. `isOperator` relies on this check.
  if (operators.provider !== "github") {
    return json(501, { error: `the router can't sign operators in with ${operators.provider} yet` });
  }
  const key = `${operators.provider}/${operators.connection}`;
  const channel = channels(store).find((c) => c.key === key)?.channel;
  if (!channel) return json(404, { error: `no channel for connection ${key}` });
  return channel;
};

/** Answers the page that signs an operator in, which sends their browser back to the CLI's callback. */
const signIn = async (request: Request, store: RouterStore) => {
  const body = await readJson<SignInRequest>(request);
  if (body instanceof Response) return body;
  if (typeof body.state !== "string") return json(400, { error: "the body needs state" });
  const channel = signInChannel(store);
  if (channel instanceof Response) return channel;
  try {
    const result: SignInResult = { url: await channel.signInUrl(body.state) };
    return json(200, result);
  } catch (error) {
    return json(502, { error: message(error) });
  }
};

/** Exchanges a sign-in code for an admin session, if the operator auth lets the operator in. */
const session = async (request: Request, store: RouterStore) => {
  const body = await readJson<SessionRequest>(request);
  if (body instanceof Response) return body;
  if (typeof body.code !== "string") return json(400, { error: "the body needs code" });
  const channel = signInChannel(store);
  if (channel instanceof Response) return channel;
  let operator: Operator;
  try {
    operator = await channel.signIn(body.code);
  } catch (error) {
    return json(401, { error: message(error) });
  }
  if (!isOperator(store.config.operators, operator)) {
    return json(403, { error: `${operator.login} isn't one of the hub's operators` });
  }
  const expires = Date.now() + SESSION_TTL_MS;
  const session = await signSession(await store.rootKey(), { ...operator, expires });
  const result: SessionResult = { session, operator: operator.login, expires };
  console.log(JSON.stringify({ operator: operator.login, id: operator.id, state: "signed in" }));
  return json(200, result);
};

/** The operator of the request's admin session, or a 401. The operator must still be in the operator auth. */
const operatorOf = async (request: Request, store: RouterStore) => {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const found = token ? await verifySession(await store.rootKey(), token) : undefined;
  if (!found || !isOperator(store.config.operators, found)) {
    return json(401, { error: "sign in as an operator" });
  }
  return found.login;
};

/** Lists each repo's last deploy, and its containers' latest builds. */
const listRepos = async (store: RouterStore) => {
  if (!store.deploys) return json(501, { error: "the router keeps no deploys" });
  const result: ReposResult = { repos: await store.deploys.list() };
  result.repos.sort((a, b) => a.repo.localeCompare(b.repo));
  return json(200, result);
};

const listDeliveries = async (store: RouterStore) => {
  const failed = await store.inbox.failed();
  failed.sort((a, b) => a.received - b.received);
  const result: DeliveriesResult = { failed };
  return json(200, result);
};

/** Replays one failed delivery, or every one. Runs reply to this router's origin. */
const replay = async (request: Request, store: RouterStore, operator: string) => {
  const body = await readJson<ReplayRequest>(request);
  if (body instanceof Response) return body;
  const { inbox } = store;
  if ((body.connection === undefined) !== (body.id === undefined)) {
    return json(400, { error: "name both connection and id, or neither" });
  }
  const targets =
    body.connection !== undefined && body.id !== undefined
      ? [{ connection: body.connection, id: body.id }]
      : (await inbox.failed()).map(({ connection, id }) => ({ connection, id }));
  const { origin } = new URL(request.url);
  const result: ReplayResult = { replayed: [], skipped: [] };
  for (const target of targets) {
    const replayed = await inbox.replay(target.connection, target.id, origin);
    result[replayed ? "replayed" : "skipped"].push(target);
  }
  console.log(JSON.stringify({ operator, ...result }));
  return json(200, result);
};

/** The routes under `/admin/`. Signing in needs no session. The others need an operator's admin session. */
const admin = async (request: Request, route: string, store: RouterStore) => {
  const { method } = request;
  if (method === "POST" && route === "sign-in") return signIn(request, store);
  if (method === "POST" && route === "session") return session(request, store);
  const operator = await operatorOf(request, store);
  if (operator instanceof Response) return operator;
  if (method === "GET" && route === "repos") return listRepos(store);
  if (method === "GET" && route === "deliveries") return listDeliveries(store);
  if (method === "POST" && route === "replay") return replay(request, store, operator);
  return json(404, { error: "not found" });
};

/**
 * The router's routes. `POST /sync` takes requests that deploy signed with
 * the sync key. `POST /relay`, `POST /messages`, `POST /heartbeat`
 * and `POST /tokens` take tickets that the router signed when it started a
 * run. `POST /builds` takes reports that the deployer signed. The routes
 * under `/admin/` are for operators. `GET /restart`, `GET
 * /restart/callback` and `GET /restart/started` are the pages of a lost
 * run's restart link, which the router signed.
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
  if (request.method === "POST" && pathname === "/heartbeat") {
    return heartbeat(request, store);
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
  if (request.method === "GET" && pathname === RESTART_PATH) {
    return restartLink(request, store);
  }
  if (request.method === "GET" && pathname === RESTART_CALLBACK_PATH) {
    return restartCallback(request, store);
  }
  if (request.method === "GET" && pathname === RESTARTED_PATH) {
    return Promise.resolve(page(200, "The run is starting again. Its replies will show on the thread."));
  }
  if (pathname.startsWith("/admin/")) {
    return admin(request, pathname.slice("/admin/".length), store);
  }
  return Promise.resolve(json(404, { error: "not found" }));
};
