import { DurableObject } from "cloudflare:workers";
import {
  type OutpostConfig,
  outpostKey,
  type RouterConfig,
} from "@notation/factory/router";
import * as github from "@notation/factory-github/router";
import type { KVNamespace, SecretsStoreSecret } from "./types.ts";

type Env = {
  FACTORY_KV: KVNamespace;
  FACTORY_ROOT_KEY: SecretsStoreSecret;
};

export class RouterContainer extends DurableObject {}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const readConfig = async (env: Env) =>
  ((await env.FACTORY_KV.get("config", "json")) ?? {}) as Partial<RouterConfig>;

/**
 * Handles a GitHub delivery:
 * 1. Finds the connection by the App id in the delivery's headers.
 * 2. Checks the signature with the App's webhook secret.
 * 3. Reads the outpost of the delivery's repo and matches its triggers.
 */
const githubWebhook = async (request: Request, env: Env) => {
  const appId = request.headers.get("x-github-hook-installation-target-id");
  const event = request.headers.get("x-github-event")!;
  const delivery = request.headers.get("x-github-delivery");
  if (!appId) return json(400, { error: "missing App id" });

  const config = await readConfig(env);
  const connection = github.connectionForApp(config as RouterConfig, appId);
  if (!connection) return json(404, { error: `no connection for App ${appId}` });

  const body = new Uint8Array(await request.arrayBuffer());
  const secret = await github.webhookSecret(await env.FACTORY_ROOT_KEY.get(), appId);
  const signature = request.headers.get("x-hub-signature-256");
  if (!(await github.verifySignature(secret, body, signature))) {
    return json(401, { error: "bad signature" });
  }

  if (event === "ping") return json(200, { ok: true });

  const payload = JSON.parse(new TextDecoder().decode(body));
  const repo: string | undefined = payload.repository?.full_name;
  if (!repo) return json(202, { delivery, event, ignored: "no repository" });

  const outpost = (await env.FACTORY_KV.get(outpostKey(repo), "json")) as
    | OutpostConfig
    | null;
  if (!outpost) return json(202, { delivery, event, repo, ignored: "no outpost" });

  const matches = github.matchTriggers(outpost, {
    connection,
    repo,
    event,
    payload,
  });
  const result = { delivery, event, action: payload.action, repo, matches };
  console.log(JSON.stringify(result));
  return json(202, result);
};

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/webhook" && request.method === "POST") {
      if (request.headers.has("x-github-event")) {
        return githubWebhook(request, env);
      }
      return json(400, { error: "unknown sender" });
    }
    return json(404, { error: "not found" });
  },
};
