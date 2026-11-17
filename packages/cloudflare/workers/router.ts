import {
  handle,
  type OutpostConfig,
  outpostKey,
  type RemoteChannel,
  type RouterConfig,
  type RouterStore,
} from "@notation/factory/router";
import type { KVNamespace } from "./types.ts";

type Env = { FACTORY_KV: KVNamespace } & Record<string, unknown>;

const store = async (env: Env): Promise<RouterStore> => ({
  config: ((await env.FACTORY_KV.get("config", "json")) ?? {}) as Partial<RouterConfig>,
  // Each channel is a Worker that the router binds as a service.
  channel: (binding) => env[binding] as RemoteChannel | undefined,
  outpost: async (repo) =>
    ((await env.FACTORY_KV.get(outpostKey(repo), "json")) ?? undefined) as
      | OutpostConfig
      | undefined,
});

export default {
  async fetch(request: Request, env: Env) {
    return handle(request, await store(env));
  },
};
