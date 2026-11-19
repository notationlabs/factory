import {
  type FailedDelivery,
  type Inbox,
  type OutpostConfig,
  outpostKey,
  type RemoteChannel,
  type RemoteDeployer,
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
    failed: async () => {
      const found: FailedDelivery[] = [];
      let cursor: string | undefined;
      do {
        const page = await env.FACTORY_KV.list({ prefix: FAILED_PREFIX, ...(cursor && { cursor }) });
        for (const { name } of page.keys) {
          const delivery = (await env.FACTORY_KV.get(name, "json")) as FailedDelivery | null;
          if (delivery) found.push(delivery);
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return found;
    },
  };
};

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
  ...(background && { background }),
});
