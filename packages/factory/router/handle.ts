import type { OutpostConfig } from "../contracts/outpost.ts";
import type { AuthorCheck, ChannelProvider, RouterContext } from "./channel.ts";

/** The KV key that the deployer stores a repo's outpost config under. `repo` is `owner/name`. */
export const outpostKey = (repo: string) => `outposts/${repo.toLowerCase()}`;

/** Where the router reads its state. A container provider adapts its own storage to it. */
export type RouterStore = RouterContext & {
  outpost(repo: string): Promise<OutpostConfig | undefined>;
};

export type TriggerMatch = { trigger: string; author: AuthorCheck };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * Handles a delivery to `/webhook`:
 * 1. Finds the provider whose delivery it is.
 * 2. Has the provider verify and parse it.
 * 3. Reads the outpost of the delivery's repo, and matches the triggers on
 *    channels of the delivery's connection and scope.
 */
const webhook = async (
  request: Request,
  providers: ChannelProvider[],
  store: RouterStore,
) => {
  const provider = providers.find((p) => p.receives(request));
  if (!provider) return json(400, { error: "unknown sender" });

  const received = await provider.receive(request, store);
  if (received.status === "rejected") return json(401, { error: received.reason });
  if (received.status === "ignored") return json(200, { ignored: received.reason });

  const { delivery } = received;
  const summary = { delivery: delivery.id, event: delivery.event, scope: delivery.scope };
  const outpost = await store.outpost(delivery.repo);
  if (!outpost) return json(202, { ...summary, ignored: "no outpost" });

  const matches: TriggerMatch[] = [];
  for (const [id, trigger] of Object.entries(outpost.triggers ?? {})) {
    const channel = outpost.channels?.[trigger.channel];
    if (
      trigger.event !== delivery.event ||
      channel?.provider !== provider.provider ||
      channel.connection !== delivery.connection ||
      channel.scope !== delivery.scope
    ) {
      continue;
    }
    const author = provider.match(trigger.match, delivery);
    if (author) matches.push({ trigger: id, author });
  }
  const result = { ...summary, matches };
  console.log(JSON.stringify(result));
  return json(202, result);
};

/** Has each provider set up its connections' platform side, pointing them at this router. */
const sync = async (
  request: Request,
  providers: ChannelProvider[],
  store: RouterStore,
) => {
  const url = `${new URL(request.url).origin}/webhook`;
  const results: Record<string, string> = {};
  for (const provider of providers) {
    Object.assign(results, await provider.sync?.({ ...store, url }));
  }
  const failed = Object.values(results).some((r) => r !== "ok");
  return json(failed ? 502 : 200, { url, connections: results });
};

/**
 * The router's routes. `POST /sync` needs no auth, because a provider's sync
 * only sets the values the router derives.
 */
export const handle = (
  request: Request,
  providers: ChannelProvider[],
  store: RouterStore,
) => {
  const { pathname } = new URL(request.url);
  if (request.method === "POST" && pathname === "/webhook") {
    return webhook(request, providers, store);
  }
  if (request.method === "POST" && pathname === "/sync") {
    return sync(request, providers, store);
  }
  return Promise.resolve(json(404, { error: "not found" }));
};
