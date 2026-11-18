import type { OutpostConfig } from "../contracts/outpost.ts";
import type { RepoPattern, RouterConfig } from "../contracts/router.ts";
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
  type BuildReportRequest,
  isBranchName,
  type Relay,
  REPLY_TTL_MS,
  type Run,
  signTicket,
  signTokenTicket,
  type TokenRequest,
  type Tokens,
  verifyBuildReport,
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
  run(run: Run): Promise<void>;
};

/** The name of the check that shows the build of a container's image, such as `factory/build dev`. */
export const buildCheckName = (container: string) => `factory/build ${container}`;

/** The directory of a repo that holds its outpost's files. */
export const FACTORY_DIR = ".factory";

/** A trigger that a delivery matched. `run` is the id of the run it started, if its author may start one. */
export type TriggerMatch = { trigger: string; author: AuthorCheck; run?: string };

/** The path that a connection's platform delivers to. `key` is the connection's key, such as `github/acme-agents`. */
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
 * 4. Starts a run for each match whose author may start one.
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
  const runs: Promise<void>[] = [];
  const origin = new URL(request.url).origin;
  for (const [id, trigger] of Object.entries(outpost.triggers ?? {})) {
    const target = outpost.channels?.[trigger.channel];
    if (
      trigger.event !== delivery.event ||
      target?.provider !== entry.provider ||
      target.connection !== name ||
      target.scope !== delivery.scope
    ) {
      continue;
    }
    const author = await channel.match(trigger.match, delivery);
    if (!author) continue;
    // Team checks need a call to the platform, which the router doesn't make yet.
    if (author.result !== "allowed") {
      matches.push({ trigger: id, author });
      continue;
    }
    const run = crypto.randomUUID();
    matches.push({ trigger: id, author, run });
    runs.push(
      dispatch({ run, trigger: id, key, channel, delivery, outpost, origin }, store).catch((error) =>
        console.error(JSON.stringify({ run, trigger: id, error: message(error) })),
      ),
    );
  }
  if (runs.length) {
    const task = Promise.all(runs);
    if (store.background) store.background(task);
    else await task;
  }
  const result = { ...summary, matches };
  console.log(JSON.stringify(result));
  return json(202, result);
};

type Dispatch = {
  run: string;
  trigger: string;
  /** The delivery's connection. */
  key: string;
  channel: RemoteChannel;
  delivery: Delivery<unknown>;
  outpost: OutpostConfig;
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
 * 1. Has the delivery's channel name the conversation, and signs a ticket
 *    for replies to its thread.
 * 2. Has the deployer call the trigger's worktree function, if it has one.
 * 3. Has the code host's channel mint a read-only token for the clone, and a
 *    token for each of the container's code host policies. Signs a ticket
 *    for new tokens.
 * 4. Hands the run to the deployer. If a step fails, the channel replies
 *    with the error.
 */
const dispatch = async (d: Dispatch, store: RouterStore) => {
  const { delivery, outpost } = d;
  const repo = delivery.repo;
  const trigger = outpost.triggers[d.trigger]!;
  const conversation = await d.channel.conversation(delivery);
  const ticket = { connection: d.key, thread: conversation.thread, expires: Date.now() + REPLY_TTL_MS };
  const rootKey = await store.rootKey();
  const reply = { url: `${d.origin}/relay`, ticket, signature: await signTicket(rootKey, ticket) };
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
      const branch = await deployer.worktree(repo, d.trigger, delivery.payload);
      if (branch !== undefined) {
        if (typeof branch !== "string" || !isBranchName(branch)) {
          throw new Error(`The worktree function of ${d.trigger} returned ${JSON.stringify(branch)}, which isn't a branch name the runner can check out.`);
        }
        worktree = { branch, ...(trigger.worktree.base && { base: trigger.worktree.base }) };
      }
    }

    const tokens = await mintTokens(store, outpost, repo, trigger.container);
    const tokenTicket = { repo, container: trigger.container, expires: Date.now() + REPLY_TTL_MS };
    const refresh = { url: `${d.origin}/tokens`, ticket: tokenTicket, signature: await signTokenTicket(rootKey, tokenTicket) };

    await deployer.run({
      id: d.run,
      repo,
      trigger: d.trigger,
      container: trigger.container,
      runtimes: container.runtimes,
      files: container.files ?? {},
      agent: { id: trigger.agent, ...agent },
      conversation: { id: conversation.id, prompt: conversation.prompt },
      ...(worktree && { worktree }),
      cloneToken: await codeHost.channel.token(repo, { contents: "read" }),
      tokens,
      refresh,
      reply,
    });
    console.log(JSON.stringify({ run: d.run, repo, trigger: d.trigger, container: trigger.container, worktree }));
  } catch (error) {
    await d.channel.reply(conversation.thread, `Couldn't start the run of trigger \`${d.trigger}\`: ${message(error)}`);
    throw error;
  }
};

/** Posts a container's reply, if the router signed its ticket, through the channel of the ticket's connection. */
const relay = async (request: Request, store: RouterStore) => {
  let body: Relay;
  try {
    body = (await request.json()) as Relay;
  } catch {
    return json(400, { error: "the body isn't JSON" });
  }
  const { ticket, signature, text } = body ?? {};
  if (!ticket || typeof signature !== "string" || typeof text !== "string") {
    return json(400, { error: "the body needs ticket, signature and text" });
  }
  if (!(await verifyTicket(await store.rootKey(), ticket, signature))) {
    return json(401, { error: "bad or expired ticket" });
  }
  const found = channels(store).find((c) => c.key === ticket.connection);
  if (!found) return json(404, { error: `no channel for connection ${ticket.connection}` });
  await found.channel.reply(ticket.thread, text);
  return json(200, { ok: true });
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

const allows = (allow: RepoPattern[], repo: string) => {
  const [owner, name] = repo.toLowerCase().split("/");
  return allow.some(
    (p) => p.owner.toLowerCase() === owner && (!p.repo || p.repo.toLowerCase() === name),
  );
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
  if (!allows(allow, repo)) {
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
  for (const container of status.building ?? []) {
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
 * only sets the values the router derives. `POST /relay` and `POST /tokens`
 * take tickets that the router signed when it started a run. `POST /builds`
 * takes reports that the deployer signed.
 */
export const handle = (request: Request, store: RouterStore) => {
  const { pathname } = new URL(request.url);
  if (request.method === "POST" && pathname.startsWith("/webhook/")) {
    return webhook(request, pathname.slice("/webhook/".length), store);
  }
  if (request.method === "POST" && pathname === "/relay") {
    return relay(request, store);
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
