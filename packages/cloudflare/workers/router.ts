import {
  handle,
  type OutpostConfig,
  outpostKey,
  type RemoteChannel,
  type RemoteDeployer,
  type RouterConfig,
  type RouterStore,
} from "@notation/factory/router";
import type { KVNamespace, SecretsStoreSecret } from "./types.ts";

type Env = {
  FACTORY_KV: KVNamespace;
  FACTORY_ROOT_KEY: SecretsStoreSecret;
  FACTORY_DEPLOYER?: RemoteDeployer;
} & Record<string, unknown>;

type Context = { waitUntil(task: Promise<unknown>): void };

const store = async (env: Env, ctx: Context): Promise<RouterStore> => ({
  config: ((await env.FACTORY_KV.get("config", "json")) ?? {}) as Partial<RouterConfig>,
  // Each channel is a Worker that the router binds as a service.
  channel: (binding) => env[binding] as RemoteChannel | undefined,
  outpost: async (repo) =>
    ((await env.FACTORY_KV.get(outpostKey(repo), "json")) ?? undefined) as
      | OutpostConfig
      | undefined,
  deployer: env.FACTORY_DEPLOYER,
  rootKey: () => env.FACTORY_ROOT_KEY.get(),
  background: (task) => ctx.waitUntil(task),
});

export default {
  async fetch(request: Request, env: Env, ctx: Context) {
    return handle(request, await store(env, ctx));
  },
};
