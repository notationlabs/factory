import { Container } from "@cloudflare/containers";
import type { Heartbeat, HeartbeatResult, Relay, RelayResult, Run } from "@notation/factory/router";
import runner from "factory:runner";
import {
  CAPACITY_RETRY_S,
  CAPACITY_WAIT_MS,
  capacityFailure,
  capacityNotice,
  type DeployerService,
  instanceName,
  isCapacityError,
  RUN_HEADERS,
  STATE_INSTANCE,
  within,
} from "./outpost-api.ts";
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
  /** The Worker's `max_instances`, as a string. */
  MAX_INSTANCES: string;
};

type DurableObjectId = { toString(): string };

type DurableObjectNamespace = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { run(run: Run): Promise<void> };
};

/** A run that waits for its container. `since` is when the Worker took it, and `noticed` whether it posted `capacityNotice`. */
type PendingRun = { run: Run; since: number; noticed?: boolean };

/** How old a signed run may be. */
const RUN_MAX_AGE_MS = 5 * 60 * 1000;

/** How often the Worker posts a heartbeat for each run that it holds while it starts a run's container. */
const HEARTBEAT_MS = 60 * 1000;

/** How long a heartbeat may take before the Worker gives up on it and tries again with the next one. */
const HEARTBEAT_TIMEOUT_MS = 10 * 1000;

/** How long the runner may take to answer a run's handoff. A runner that works answers 202 at once. */
const HANDOFF_TIMEOUT_MS = 60 * 1000;

/** The prefix of each run that the Durable Object holds but hasn't handed to the runner, as a `Run` under `pending/<run id>`. */
const PENDING = "pending/";

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
 * keeps under the id of the Worker's `STATE_INSTANCE`. So a container
 * outlives its `/data`, and reads only the objects of its Worker's
 * containers, which share them.
 */
const stateStore = async (request: Request, env: Env) => {
  const namespace = env.OUTPOSTS.idFromName(STATE_INSTANCE).toString();
  const key = new URL(request.url).pathname.slice(1);
  if (!/^[\w.%/-]+$/.test(key) || key.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return new Response("not a key", { status: 400 });
  }
  if (request.method === "GET") {
    const found = await env.DEPLOYER.getState(namespace, key);
    return found ? new Response(found) : new Response("not found", { status: 404 });
  }
  if (request.method === "PUT") {
    const length = Number(request.headers.get("content-length"));
    if (!Number.isInteger(length)) return new Response("needs content-length", { status: 411 });
    await env.DEPLOYER.putState(namespace, key, request.body, length);
    return new Response(null, { status: 204 });
  }
  return new Response("method not allowed", { status: 405 });
};

/** Forwards a container's request to `<name>.factory` to the router, with the repo and container that sent it. */
const service = (request: Request, env: Env) => env.SERVICES.fetch(fromSender(request, env.REPO, env.CONTAINER));

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Posts `text` to the run's conversation, through the router, in place of
 * the message the router posted while the run waited, if there is one.
 * With `done`, it's the run's last reply. Returns the message it posted, if
 * the channel names it.
 */
const relay = async (run: Run, text: string, done = false) => {
  const body: Relay = {
    ticket: run.reply.ticket,
    signature: run.reply.signature,
    text,
    ...(run.reply.message && { message: run.reply.message }),
    ...(done && { done }),
  };
  const response = await fetch(run.reply.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.error(JSON.stringify({ run: run.id, relay: response.status, error: await response.text() }));
    return undefined;
  }
  return ((await response.json()) as RelayResult).message;
};

/**
 * Posts a heartbeat for a run that the Worker hasn't handed to the runner
 * yet, so that the router can mark the run lost if the Worker stops
 * delivering it. Resolves to `lost` if the router marked the run lost, and
 * to `retry` if the router couldn't be reached or failed. The runner's
 * `postHeartbeat` posts the same body and reads the answer the same way.
 */
const heartbeat = async (run: Run): Promise<"ok" | "lost" | "retry"> => {
  if (!run.reply.heartbeat) return "ok";
  const posted = run.reply.message;
  const body: Heartbeat = { ticket: run.reply.ticket, signature: run.reply.signature, ...(posted && { message: posted }) };
  try {
    const response = await fetch(run.reply.heartbeat, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(JSON.stringify({ run: run.id, heartbeat: response.status, error: await response.text() }));
      return response.status < 500 ? "ok" : "retry";
    }
    return ((await response.json().catch(() => ({}))) as Partial<HeartbeatResult>).lost ? "lost" : "ok";
  } catch (error) {
    console.error(JSON.stringify({ run: run.id, heartbeat: "failed", error: message(error) }));
    return "retry";
  }
};

/**
 * The outpost container, which this Worker's image runs. Each worktree has
 * its own, named by `instanceName`. The runner in the container queues the
 * runs it's given. The container sleeps once it's idle for `SLEEP_AFTER`.
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
   * longer to start than the caller waits. It holds the run under `PENDING`
   * until `deliver` is done with it, and posts the run's first heartbeat,
   * which has the router start watching the run.
   */
  async run(run: Run) {
    // A retried inbox alarm dispatches the same run again.
    if (await this.ctx.storage.get(`${PENDING}${run.id}`)) return;
    await this.ctx.storage.put(`${PENDING}${run.id}`, run);
    await heartbeat(run);
    await this.schedule(0, "deliver", { run, since: Date.now() } satisfies PendingRun);
  }

  /**
   * Starts the container and hands it the run. When Cloudflare has no
   * instance for the container, such as when the Worker has
   * `MAX_INSTANCES` containers running, the run tries again every
   * `CAPACITY_RETRY_S` until `CAPACITY_WAIT_MS` has passed. It posts
   * `capacityNotice` once, which the run's first reply replaces.
   * It posts the run's heartbeats until the runner takes the run, which
   * posts them from then on. The scheduled calls of `deliver` run one at a
   * time, so while it starts the container it also posts the heartbeats of
   * the other runs under `PENDING`, which wait for their turn. It drops a
   * run that the router marked lost. Its reply for a run that it couldn't
   * deliver is the run's last.
   */
  async deliver({ run, since, noticed }: PendingRun) {
    const key = `${PENDING}${run.id}`;
    if ((await heartbeat(run)) === "lost") {
      console.error(JSON.stringify({ run: run.id, lost: true }));
      await this.ctx.storage.delete(key);
      return;
    }
    const beating = setInterval(() => void this.beatPending(), HEARTBEAT_MS);
    let retrying = false;
    try {
      await this.startAndWaitForPorts({
        startOptions: { envVars: await this.env.DEPLOYER.credentials(run.runtimes, run.repo) },
        cancellationOptions: { instanceGetTimeoutMS: START_TIMEOUT_MS, portReadyTimeoutMS: START_TIMEOUT_MS },
      });
      const handoff = async () => {
        const response = await this.containerFetch("http://runner/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(run),
          signal: AbortSignal.timeout(HANDOFF_TIMEOUT_MS),
        });
        // `containerFetch` counts the request as in flight until its body is read,
        // and the container never sleeps while a request is in flight.
        return { response, body: await response.text() };
      };
      const { response, body } = await within(
        handoff(),
        HANDOFF_TIMEOUT_MS,
        `The runner didn't answer within ${HANDOFF_TIMEOUT_MS / 1000} seconds.`,
      );
      if (!response.ok) throw new Error(`The runner refused the run with status ${response.status}: ${body}`);
      console.log(JSON.stringify({ run: run.id, repo: run.repo, container: run.container, delivered: true }));
    } catch (error) {
      const max = Number(this.env.MAX_INSTANCES);
      if (isCapacityError(error)) {
        const waited = Date.now() - since;
        console.error(JSON.stringify({ run: run.id, waiting: true, ms: waited, error: message(error) }));
        if (waited < CAPACITY_WAIT_MS) {
          const posted = noticed ? undefined : await relay(run, capacityNotice(run.container, max));
          const next = posted ? { ...run, reply: { ...run.reply, message: posted } } : run;
          await this.ctx.storage.put(key, next);
          await this.schedule(CAPACITY_RETRY_S, "deliver", { run: next, since, noticed: true } satisfies PendingRun);
          retrying = true;
          return;
        }
        await relay(run, capacityFailure(run.container, max), true);
      } else {
        console.error(JSON.stringify({ run: run.id, error: message(error) }));
        await relay(run, `The container \`${run.container}\` couldn't take the run: ${message(error)}`, true);
      }
    } finally {
      clearInterval(beating);
      if (!retrying) await this.ctx.storage.delete(key);
    }
  }

  /** Posts a heartbeat for each run under `PENDING`. */
  private async beatPending() {
    const pending = (await this.ctx.storage.list({ prefix: PENDING })) as Map<string, Run>;
    await Promise.all([...pending.values()].map((run) => heartbeat(run)));
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
    await env.OUTPOSTS.get(env.OUTPOSTS.idFromName(instanceName(run))).run(run);
    return new Response(null, { status: 202 });
  },
};
