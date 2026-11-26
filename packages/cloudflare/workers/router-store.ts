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
import type { RepoSync } from "./repo-sync.ts";
import type { DurableObjectNamespace, KVNamespace, SecretsStoreSecret } from "./types.ts";

export type RouterEnv = {
  FACTORY_KV: KVNamespace;
  FACTORY_ROOT_KEY: SecretsStoreSecret;
  FACTORY_SYNC_KEY?: SecretsStoreSecret;
  FACTORY_DEPLOYER?: RemoteDeployer;
  INBOX: DurableObjectNamespace<DeliveryInbox>;
  REPO_SYNC: DurableObjectNamespace<RepoSync>;
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
    heartbeat: (connection, id, run, beat) => object(connection, id).heartbeat(run, beat),
    failed: async () => (await listJson<FailedDelivery>(env.FACTORY_KV, FAILED_PREFIX)).map(({ value }) => value),
  };
};

/** The KV prefix of each repo's last deploy, which the router writes when it deploys the repo. */
export const DEPLOYS_PREFIX = "deploys/";

/** The KV prefix of each container's latest build, as `builds/<repo>/<container>`. */
export const BUILDS_PREFIX = "builds/";

const deployKey = (repo: string) => `${DEPLOYS_PREFIX}${repo.toLowerCase()}`;

const buildKey = (repo: string, container: string) => `${BUILDS_PREFIX}${repo.toLowerCase()}/${container}`;

/** Each key in KV under `prefix`. */
const listKeys = async (kv: KVNamespace, prefix: string) => {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, ...(cursor && { cursor }) });
    keys.push(...page.keys.map(({ name }) => name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
};

/** Each key in KV under `prefix`, with its value. */
const listJson = async <T>(kv: KVNamespace, prefix: string) => {
  const keys = await listKeys(kv, prefix);
  const values = await Promise.all(keys.map((key) => kv.get(key, "json") as Promise<T | null>));
  return keys.flatMap((key, i) => (values[i] ? [{ key, value: values[i] as T }] : []));
};

type DeployRecord = { repo: string; status: FactoryStatus };

const deploys = (env: RouterEnv): DeployLog => {
  const kv = env.FACTORY_KV;
  return {
    put: (repo, status) => kv.put(deployKey(repo), JSON.stringify({ repo, status } satisfies DeployRecord)),
    remove: async (repo) => {
      const builds = await listKeys(kv, `${BUILDS_PREFIX}${repo.toLowerCase()}/`);
      await Promise.all([kv.delete(deployKey(repo)), ...builds.map((key) => kv.delete(key))]);
    },
    build: async (repo, container) => ((await kv.get(buildKey(repo, container), "json")) ?? undefined) as ContainerBuild | undefined,
    putBuild: (repo, container, build) => kv.put(buildKey(repo, container), JSON.stringify(build)),
    pruneBuilds: async (repo, containers) => {
      const kept = new Set(containers.map((container) => buildKey(repo, container)));
      const builds = await listKeys(kv, `${BUILDS_PREFIX}${repo.toLowerCase()}/`);
      await Promise.all(builds.filter((key) => !kept.has(key)).map((key) => kv.delete(key)));
    },
    repos: async () => (await listKeys(kv, DEPLOYS_PREFIX)).map((key) => key.slice(DEPLOYS_PREFIX.length)),
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
  syncKey: async () => env.FACTORY_SYNC_KEY?.get(),
  inbox: inbox(env),
  deploys: deploys(env),
  queueDeploys: (changes) => env.REPO_SYNC.get(env.REPO_SYNC.idFromName("sync")).start(changes),
  ...(background && { background }),
});
