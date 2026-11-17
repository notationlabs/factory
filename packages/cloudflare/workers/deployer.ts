import { WorkerEntrypoint } from "cloudflare:workers";
import { deploy, evaluateOutpost } from "@notation/factory/deployer";
import { outpostKey, type SourceFiles } from "@notation/factory/router";
import { loaderContext } from "./loader.ts";
import type { KVNamespace, WorkerLoader } from "./types.ts";

type Env = { LOADER: WorkerLoader; FACTORY_KV: KVNamespace } & Record<string, unknown>;

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
      putOutpost: (repo: string, outpost: unknown) => kv.put(outpostKey(repo), JSON.stringify(outpost)),
      deleteOutpost: (repo: string) => kv.delete(outpostKey(repo)),
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
}
