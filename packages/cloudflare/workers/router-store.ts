import {
  type ContainerBuild,
  type DeployLog,
  type FactoryStatus,
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
    failed: async () => (await listJson<FailedDelivery>(env.FACTORY_KV, FAILED_PREFIX)).map(({ value }) => value),
  };
};

/** The KV prefix of each repo's last deploy, which the router writes when it deploys the repo. */
export const DEPLOYS_PREFIX = "deploys/";

/** The KV prefix of each container's latest build, as `builds/<repo>/<container>`. */
export const BUILDS_PREFIX = "builds/";

const deployKey = (repo: string) => `${DEPLOYS_PREFIX}${repo.toLowerCase()}`;

const buildKey = (repo: string, container: string) => `${BUILDS_PREFIX}${repo.toLowerCase()}/${container}`;

/** Each key in KV under `prefix`, with its value. */
const listJson = async <T>(kv: KVNamespace, prefix: string) => {
  const found: { key: string; value: T }[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, ...(cursor && { cursor }) });
    const values = await Promise.all(page.keys.map(({ name }) => kv.get(name, "json") as Promise<T | null>));
    page.keys.forEach(({ name }, i) => {
      const value = values[i];
      if (value) found.push({ key: name, value });
    });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return found;
};

type DeployRecord = { repo: string; status: FactoryStatus };

const deploys = (env: RouterEnv): DeployLog => {
  const kv = env.FACTORY_KV;
  return {
    put: (repo, status) => kv.put(deployKey(repo), JSON.stringify({ repo, status } satisfies DeployRecord)),
    remove: async (repo) => {
      const builds = await listJson<ContainerBuild>(kv, `${BUILDS_PREFIX}${repo.toLowerCase()}/`);
      await Promise.all([kv.delete(deployKey(repo)), ...builds.map(({ key }) => kv.delete(key))]);
    },
    build: async (repo, container) => ((await kv.get(buildKey(repo, container), "json")) ?? undefined) as ContainerBuild | undefined,
    putBuild: (repo, container, build) => kv.put(buildKey(repo, container), JSON.stringify(build)),
    list: async () => {
      const [records, builds] = await Promise.all([
        listJson<DeployRecord>(kv, DEPLOYS_PREFIX),
        listJson<ContainerBuild>(kv, BUILDS_PREFIX),
      ]);
      const repos = new Map<string, RepoDeploy>(
        records.map(({ value }) => [value.repo.toLowerCase(), { ...value, builds: {} }]),
      );
      for (const { key, value } of builds) {
        const path = key.slice(BUILDS_PREFIX.length);
        const slash = path.lastIndexOf("/");
        const deploy = repos.get(path.slice(0, slash));
        if (deploy) deploy.builds[path.slice(slash + 1)] = value;
      }
      return [...repos.values()];
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
  deploys: deploys(env),
  ...(background && { background }),
});
