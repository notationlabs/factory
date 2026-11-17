import { WorkerEntrypoint } from "cloudflare:workers";
import { evaluateOutpost } from "@notation/factory/deployer";
import { loaderContext } from "./loader.ts";
import type { WorkerLoader } from "./types.ts";

type Env = { LOADER: WorkerLoader } & Record<string, unknown>;

/** The hub's deployer, which the router calls over its service binding. */
export default class DeployerWorker extends WorkerEntrypoint<Env> {
  // Cloudflare refuses a Worker whose default export has no event handler,
  // and RPC methods don't count as one.
  fetch() {
    return new Response("not found", { status: 404 });
  }

  /** Evaluates a repo's `.factory/` files, keyed by their path in `.factory/`, and returns its outpost config. */
  evaluate(repo: string, files: Record<string, string>) {
    return evaluateOutpost(repo, files, loaderContext(this.env.LOADER));
  }
}
