import { Container, type OutboundHandlerContext } from "@cloudflare/containers";
import { WorkerEntrypoint } from "cloudflare:workers";
import { deploy, evaluateOutpost, worktree } from "@notation/factory/deployer";
import {
  type OutpostConfig,
  outpostKey,
  type Relay,
  type Run,
  type SourceFiles,
} from "@notation/factory/router";
import { loaderContext } from "./loader.ts";
import type { KVNamespace, R2Bucket, SecretsStoreSecret, WorkerLoader } from "./types.ts";

// Outbound interception calls the handlers through this entrypoint.
export { ContainerProxy } from "@cloudflare/containers";

type Env = {
  LOADER: WorkerLoader;
  FACTORY_KV: KVNamespace;
  FACTORY_BUCKET: R2Bucket;
  OUTPOSTS: OutpostNamespace;
  /** How long an outpost container stays up with no run in progress, such as `"10m"`. */
  SLEEP_AFTER: string;
  /** The names of each runtime's account secrets, which the deployer binds under those names. */
  ACCOUNTS: Record<string, string[]>;
} & Record<string, unknown>;

type OutpostNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { run(run: Run): Promise<void> };
};

/** The KV key of the `.factory/` files that a repo's outpost was deployed from. */
const filesKey = (repo: string) => `outpost-files/${repo.toLowerCase()}`;

/** The port that the runner listens on. */
const RUNNER_PORT = 8080;

/** How long a container may take to start. The first start of an image pulls it. */
const START_TIMEOUT_MS = 5 * 60 * 1000;

/** The host that a container's runner reaches its state store at. */
const STATE_HOST = "state.factory";

/**
 * A container's state store: `GET` and `PUT` of objects, which the bucket
 * keeps under `outposts/<container id>/`. So a container outlives its
 * `/data`, and reads only its own objects.
 */
const stateStore = async (request: Request, env: Env, ctx: OutboundHandlerContext) => {
  const key = new URL(request.url).pathname.slice(1);
  if (!/^[\w.%/-]+$/.test(key) || key.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return new Response("not a key", { status: 400 });
  }
  const object = `outposts/${ctx.containerId}/${key}`;
  if (request.method === "GET") {
    const found = await env.FACTORY_BUCKET.get(object);
    return found ? new Response(found.body) : new Response("not found", { status: 404 });
  }
  if (request.method === "PUT") {
    await env.FACTORY_BUCKET.put(object, request.body);
    return new Response(null, { status: 204 });
  }
  return new Response("method not allowed", { status: 405 });
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Posts `text` to the run's conversation, through the router. */
const relay = async (run: Run, text: string) => {
  const body: Relay = { ticket: run.reply.ticket, signature: run.reply.signature, text };
  const response = await fetch(run.reply.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.error(JSON.stringify({ run: run.id, relay: response.status, error: await response.text() }));
  }
};

/**
 * One outpost container, keyed by repo and container id. The runner in the
 * container queues the runs it's given. The container sleeps once it's idle
 * for `sleepAfter`.
 */
export class OutpostContainer extends Container<Env> {
  defaultPort = RUNNER_PORT;
  entrypoint = ["/usr/local/bin/factory-runner"];

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env);
    // The base class reads `sleepAfter` after a microtask, so this value
    // applies to the first activity timeout too.
    this.sleepAfter = env.SLEEP_AFTER;
  }

  /**
   * Hands `run` to the runner in an alarm, so that the container may take
   * longer to start than the caller waits.
   */
  async run(run: Run) {
    await this.schedule(0, "deliver", run);
  }

  async deliver(run: Run) {
    try {
      await this.startAndWaitForPorts({
        startOptions: { envVars: await this.#credentials(run.runtimes) },
        cancellationOptions: { instanceGetTimeoutMS: START_TIMEOUT_MS, portReadyTimeoutMS: START_TIMEOUT_MS },
      });
      const response = await this.containerFetch("http://runner/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(run),
      });
      // `containerFetch` counts the request as in flight until its body is read,
      // and the container never sleeps while a request is in flight.
      const body = await response.text();
      if (!response.ok) throw new Error(`The runner refused the run with status ${response.status}: ${body}`);
      console.log(JSON.stringify({ run: run.id, repo: run.repo, container: run.container, delivered: true }));
    } catch (error) {
      console.error(JSON.stringify({ run: run.id, error: message(error) }));
      await relay(run, `The container \`${run.container}\` couldn't take the run: ${message(error)}`);
    }
  }

  /** The secrets of the accounts of `runtimes`, by the env var names that containers read them as. */
  async #credentials(runtimes: string[]) {
    const env: Record<string, string> = {};
    for (const runtime of runtimes) {
      const names = this.env.ACCOUNTS[runtime];
      if (!names) throw new Error(`The hub has no account for the runtime ${runtime}.`);
      for (const name of names) env[name] = await (this.env[name] as SecretsStoreSecret).get();
    }
    return env;
  }

  // A run can last longer than `sleepAfter` without a request to the object.
  override async onActivityExpired() {
    if (this.ctx.container?.running) {
      try {
        const response = await this.containerFetch("http://runner/status");
        const { active } = (await response.json()) as { active: number };
        if (active > 0) return;
      } catch (error) {
        console.error(JSON.stringify({ status: message(error) }));
      }
    }
    await super.onActivityExpired();
  }
}

// The setter registers the handlers by class name. A static field would
// define its own property instead, and the proxy wouldn't find them.
OutpostContainer.outboundByHost = { [STATE_HOST]: stateStore };

/** The hub's deployer, which the router calls over its service binding. */
export default class DeployerWorker extends WorkerEntrypoint<Env> {
  // Cloudflare refuses a Worker whose default export has no event handler,
  // and RPC methods don't count as one.
  fetch() {
    return new Response("not found", { status: 404 });
  }

  #context() {
    const kv = this.env.FACTORY_KV;
    return {
      ...loaderContext(this.env.LOADER),
      putOutpost: async (repo: string, outpost: OutpostConfig, files: Record<string, string>) => {
        await kv.put(filesKey(repo), JSON.stringify(files));
        await kv.put(outpostKey(repo), JSON.stringify(outpost));
      },
      getFiles: async (repo: string) =>
        ((await kv.get(filesKey(repo), "json")) ?? undefined) as Record<string, string> | undefined,
      deleteOutpost: async (repo: string) => {
        await kv.delete(outpostKey(repo));
        await kv.delete(filesKey(repo));
      },
    };
  }

  /** Evaluates a repo's `.factory/` files, keyed by their path in `.factory/`, and returns its outpost config. */
  evaluate(repo: string, files: Record<string, string>) {
    return evaluateOutpost(repo, files, this.#context());
  }

  deploy(repo: string, source: SourceFiles) {
    return deploy(repo, source, this.#context());
  }

  remove(repo: string) {
    return this.#context().deleteOutpost(repo);
  }

  worktree(repo: string, trigger: string, payload: unknown) {
    return worktree(repo, trigger, payload, this.#context());
  }

  /** Hands `run` to the container of its repo and container id. */
  async run(run: Run) {
    const outposts = this.env.OUTPOSTS;
    await outposts.get(outposts.idFromName(`${run.repo.toLowerCase()}/${run.container}`)).run(run);
  }
}
