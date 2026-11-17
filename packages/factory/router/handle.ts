import type { OutpostConfig } from "../contracts/outpost.ts";
import type { RepoPattern, RouterConfig } from "../contracts/router.ts";
import type {
  AuthorCheck,
  FactoryStatus,
  RemoteChannel,
  SourceChange,
  SourceFiles,
} from "./channel.ts";

/** The KV key that the deployer stores a repo's outpost config under. `repo` is `owner/name`. */
export const outpostKey = (repo: string) => `outposts/${repo.toLowerCase()}`;

/** Where the router reads its state, and finds each connection's channel. Each platform adapts its own storage to it. */
export type RouterStore = {
  config: Partial<RouterConfig>;
  /** The channel that the router reaches by `binding`, the name in a connection's entry. */
  channel(binding: string): RemoteChannel | undefined;
  outpost(repo: string): Promise<OutpostConfig | undefined>;
  deployer?: RemoteDeployer;
  /** Keeps `task` running after the response, where the platform allows it. Without it, the router waits for the task. */
  background?(task: Promise<unknown>): void;
};

/** The deployer, as the router calls it. */
export type RemoteDeployer = {
  /** Evaluates the repo's `.factory/` files and stores its outpost config. Resolves to the status to show on the repo. */
  deploy(repo: string, source: SourceFiles): Promise<FactoryStatus>;
  /** Removes the repo's outpost config. */
  remove(repo: string): Promise<void>;
};

/** The directory of a repo that holds its outpost's files. */
export const FACTORY_DIR = ".factory";

export type TriggerMatch = { trigger: string; author: AuthorCheck };

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
    if (author) matches.push({ trigger: id, author });
  }
  const result = { ...summary, matches };
  console.log(JSON.stringify(result));
  return json(202, result);
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
 * 3. The channel shows the outcome on the repo.
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
 * only sets the values the router derives.
 */
export const handle = (request: Request, store: RouterStore) => {
  const { pathname } = new URL(request.url);
  if (request.method === "POST" && pathname.startsWith("/webhook/")) {
    return webhook(request, pathname.slice("/webhook/".length), store);
  }
  if (request.method === "POST" && pathname === "/sync") {
    return sync(request, store);
  }
  return Promise.resolve(json(404, { error: "not found" }));
};
