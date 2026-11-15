import { DurableObject } from "cloudflare:workers";
import {
  handle,
  type OutpostConfig,
  outpostKey,
  type RouterConfig,
  type RouterStore,
} from "@notation/factory/router";
import * as github from "@notation/factory-github/router";
import type { KVNamespace, SecretsStoreSecret } from "./types.ts";

type Env = { FACTORY_KV: KVNamespace } & Record<string, unknown>;

export class RouterContainer extends DurableObject {}

/** The channel providers bundled into the router. */
const providers = [github.channel];

const store = async (env: Env): Promise<RouterStore> => {
  const secret = async (name: string) => {
    const binding = env[name] as SecretsStoreSecret | undefined;
    if (!binding) throw new Error(`no secret bound as ${name}`);
    return binding.get();
  };
  return {
    config: ((await env.FACTORY_KV.get("config", "json")) ?? {}) as Partial<RouterConfig>,
    secret,
    rootKey: () => secret("FACTORY_ROOT_KEY"),
    outpost: async (repo) =>
      ((await env.FACTORY_KV.get(outpostKey(repo), "json")) ?? undefined) as
        | OutpostConfig
        | undefined,
  };
};

export default {
  async fetch(request: Request, env: Env) {
    return handle(request, providers, await store(env));
  },
};
