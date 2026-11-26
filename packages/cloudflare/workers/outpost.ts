import { Container, type OutboundHandlerContext } from "@cloudflare/containers";
import type { Relay, Run } from "@notation/factory/router";
import runner from "factory:runner";
import { type DeployerService, RUN_HEADERS } from "./outpost-api.ts";
import { type Fetcher, fromSender, SERVICE_SUFFIX } from "./services.ts";

// Outbound interception calls the handlers through this entrypoint.
export { ContainerProxy } from "@cloudflare/containers";

type Env = {
  OUTPOSTS: DurableObjectNamespace;
  DEPLOYER: DeployerService;
  /** The router's `ServiceGateway` entrypoint, which forwards requests to the hub's services. */
  SERVICES: Fetcher;
  /** This Worker's name, which the deployer signs runs for. */
  WORKER_NAME: string;
  /** The repo whose container this Worker runs, which services get as the sender. */
  REPO: string;
  /** The container's id in the repo's outpost config. */
  CONTAINER: string;
  /** How long the container stays up with no run in progress, such as `"10m"`. */
  SLEEP_AFTER: string;
};

type DurableObjectNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { run(run: Run): Promise<void> };
};

/** How old a signed run may be. */
const RUN_MAX_AGE_MS = 5 * 60 * 1000;

/** The port that the runner listens on. */
const RUNNER_PORT = 8080;

/** How long a container may take to start. The first start of an image pulls it. */
const START_TIMEOUT_MS = 5 * 60 * 1000;

/** The host that a container's runner reaches its state store at. */
const STATE_HOST = "state.factory";

/** The host that a container's entrypoint fetches the runner from, and the runner its plugins' runner modules. */
const RUNNER_HOST = "runner.factory";

/** Where the entrypoint writes the runner, which bun runs as it is. */
const RUNNER_FILE = "/tmp/factory-runner.ts";

/**
 * Serves the runner at `/runner.ts`, so an image needs only bun to run it,
 * and the hub's runner modules, which the deployer has, at their paths.
 */
const runnerSource = async (request: Request, env: Env) => {
  const path = new URL(request.url).pathname.slice(1);
  const source = path === "runner.ts" ? runner : await env.DEPLOYER.runnerModule(path);
  if (source === null) return new Response("not found", { status: 404 });
  return new Response(source, { headers: { "content-type": "text/typescript" } });
};

/**
 * A container's state store: `GET` and `PUT` of objects, which the deployer
 * keeps under the container's id. So a container outlives its `/data`, and
 * reads only its own objects.
 */
const stateStore = async (request: Request, env: Env, ctx: OutboundHandlerContext) => {
  const key = new URL(request.url).pathname.slice(1);
  if (!/^[\w.%/-]+$/.test(key) || key.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return new Response("not a key", { status: 400 });
  }
  if (request.method === "GET") {
    const found = await env.DEPLOYER.getState(ctx.containerId, key);
    return found ? new Response(found) : new Response("not found", { status: 404 });
  }
  if (request.method === "PUT") {
    const length = Number(request.headers.get("content-length"));
    if (!Number.isInteger(length)) return new Response("needs content-length", { status: 411 });
    await env.DEPLOYER.putState(ctx.containerId, key, request.body, length);
    return new Response(null, { status: 204 });
  }
  return new Response("method not allowed", { status: 405 });
};

/** Forwards a container's request to `<name>.factory` to the router, with the repo and container that sent it. */
const service = (request: Request, env: Env) => env.SERVICES.fetch(fromSender(request, env.REPO, env.CONTAINER));

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
 * The outpost container, which this Worker's image runs. The runner in the
 * container queues the runs it's given. The container sleeps once it's idle
 * for `SLEEP_AFTER`.
 */
export class OutpostContainer extends Container<Env> {
  defaultPort = RUNNER_PORT;
  entrypoint = [
    "bun",
    "-e",
    `await Bun.write(${JSON.stringify(RUNNER_FILE)}, await fetch("http://${RUNNER_HOST}/runner.ts")); await import(${JSON.stringify(RUNNER_FILE)});`,
  ];

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
        startOptions: { envVars: await this.env.DEPLOYER.credentials(run.runtimes, run.repo) },
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
// define its own property instead, and the proxy wouldn't find them. The
// proxy tries exact hosts before globs, so the glob leaves state and runner.
OutpostContainer.outboundByHost = {
  [STATE_HOST]: stateStore,
  [RUNNER_HOST]: runnerSource,
  [`*${SERVICE_SUFFIX}`]: service,
};

/**
 * Takes `POST /runs` from the hub's deployer, signed with a key derived
 * from the root key, and hands the run to the container.
 */
export default {
  async fetch(request: Request, env: Env) {
    const { pathname } = new URL(request.url);
    if (request.method !== "POST" || pathname !== "/runs") return new Response("not found", { status: 404 });
    const timestamp = request.headers.get(RUN_HEADERS.timestamp) ?? "";
    const signature = request.headers.get(RUN_HEADERS.signature) ?? "";
    const body = await request.text();
    const age = Date.now() - Number(timestamp);
    if (!(age >= -RUN_MAX_AGE_MS && age <= RUN_MAX_AGE_MS)) return new Response("stale", { status: 401 });
    if (!(await env.DEPLOYER.verifyRun(env.WORKER_NAME, timestamp, body, signature))) {
      return new Response("bad signature", { status: 401 });
    }
    const run = JSON.parse(body) as Run;
    await env.OUTPOSTS.get(env.OUTPOSTS.idFromName("outpost")).run(run);
    return new Response(null, { status: 202 });
  },
};
