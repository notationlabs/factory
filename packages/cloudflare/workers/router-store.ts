import {
  type DeployLog,
  type FailedDelivery,
  type Inbox,
  type OutpostConfig,
  outpostKey,
  type RemoteChannel,
  type RemoteDeployer,
  type RepoDeploy,
  type RouterConfig,
  type RouterStore,
} from "@notation/factory/router";
import type { DeliveryInbox } from "./inbox.ts";
import type { DurableObjectNamespace, KVNamespace, SecretsStoreSecret } from "./types.ts";

export type RouterEnv = {
  FACTORY_KV: KVNamespace;
  FACTORY_ROOT_KEY: SecretsStoreSecret;
  FACTORY_DEPLOYER?: RemoteDeployer;
  INBOX: DurableObjectNamespace<DeliveryInbox>;
} & Record<string, unknown>;

/** The KV prefix of the failed deliveries, which the inbox writes when a delivery fails. */
export const FAILED_PREFIX = "deliveries/failed/";

export const failedKey = (connection: string, id: string) => `${FAILED_PREFIX}${connection}/${id}`;

/** The inbox: a `DeliveryInbox` object for each delivery, named by its connection and id. */
const inbox = (env: RouterEnv): Inbox => {
  const object = (connection: string, id: string) => env.INBOX.get(env.INBOX.idFromName(`${connection}/${id}`));
  return {
    receive: (record) => object(record.connection, record.id).receive(record),
    replay: (connection, id, origin) => object(connection, id).replay(origin),
    failed: () => listJson<FailedDelivery>(env.FACTORY_KV, FAILED_PREFIX),
  };
};

/** The KV prefix of each repo's last deploy, which the router writes when it deploys the repo. */
export const DEPLOYS_PREFIX = "deploys/";

const deployKey = (repo: string) => `${DEPLOYS_PREFIX}${repo.toLowerCase()}`;

/** Every value in KV under `prefix`. */
const listJson = async <T>(kv: KVNamespace, prefix: string) => {
  const found: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, ...(cursor && { cursor }) });
    const values = await Promise.all(page.keys.map(({ name }) => kv.get(name, "json") as Promise<T | null>));
    for (const value of values) if (value) found.push(value);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return found;
};

const deploys = (env: RouterEnv): DeployLog => ({
  get: async (repo) => ((await env.FACTORY_KV.get(deployKey(repo), "json")) ?? undefined) as RepoDeploy | undefined,
  put: (deploy) => env.FACTORY_KV.put(deployKey(deploy.repo), JSON.stringify(deploy)),
  remove: (repo) => env.FACTORY_KV.delete(deployKey(repo)),
  list: () => listJson<RepoDeploy>(env.FACTORY_KV, DEPLOYS_PREFIX),
});

/** The router's store, which the router Worker and the inbox's objects share. */
export const routerStore = async (env: RouterEnv, background?: (task: Promise<unknown>) => void): Promise<RouterStore> => ({
  config: ((await env.FACTORY_KV.get("config", "json")) ?? {}) as Partial<RouterConfig>,
  // Each channel is a Worker that the router binds as a service.
  channel: (binding) => env[binding] as RemoteChannel | undefined,
  outpost: async (repo) =>
    ((await env.FACTORY_KV.get(outpostKey(repo), "json")) ?? undefined) as OutpostConfig | undefined,
  deployer: env.FACTORY_DEPLOYER,
  rootKey: () => env.FACTORY_ROOT_KEY.get(),
  inbox: inbox(env),
  deploys: deploys(env),
  ...(background && { background }),
});
