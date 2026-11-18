import { WorkerEntrypoint } from "cloudflare:workers";
import { deploy, evaluateOutpost, worktree } from "@notation/factory/deployer";
import { type OutpostConfig, outpostKey, type Run, type SourceFiles } from "@notation/factory/router";
import type { BuildWatch } from "./build-watch.ts";
import { loaderContext } from "./loader.ts";
import type { DeployerService } from "./outpost-api.ts";
import runnerModules from "factory:runner-modules";
import { deployOutposts, type OutpostsEnv, postRun, verifyRun } from "./outposts.ts";
import type { DurableObjectNamespace, R2Bucket, SecretsStoreSecret, WorkerLoader } from "./types.ts";

type Env = OutpostsEnv & {
  LOADER: WorkerLoader;
  FACTORY_BUCKET: R2Bucket;
  BUILDS: DurableObjectNamespace<BuildWatch>;
} & Record<string, unknown>;

/** The KV key of the `.factory/` files that a repo's outpost was deployed from. */
const filesKey = (repo: string) => `outpost-files/${repo.toLowerCase()}`;

/** The bucket key of an object in a container's state store. */
const stateKey = (container: string, key: string) => `outposts/${container}/${key}`;

/** The hub's deployer, which the router calls over its service binding. */
export default class DeployerWorker extends WorkerEntrypoint<Env> implements DeployerService {
  // Cloudflare refuses a Worker whose default export has no event handler,
  // and RPC methods don't count as one.
  fetch() {
    return new Response("not found", { status: 404 });
  }

  #context() {
    const kv = this.env.FACTORY_KV;
    return {
      ...loaderContext(this.env.LOADER),
      putOutpost: async (repo: string, outpost: OutpostConfig, files: Record<string, string>, ref: string) => {
        const started = await deployOutposts(this.env, repo, outpost, files);
        await kv.put(filesKey(repo), JSON.stringify(files));
        await kv.put(outpostKey(repo), JSON.stringify(outpost));
        if (started.length) {
          const watch = this.env.BUILDS.get(this.env.BUILDS.idFromName("builds"));
          await watch.watch(started.map((build) => ({ ...build, repo, ref })));
        }
        return started.map((build) => build.container);
      },
      getFiles: async (repo: string) =>
        ((await kv.get(filesKey(repo), "json")) ?? undefined) as Record<string, string> | undefined,
      deleteOutpost: async (repo: string) => {
        await deployOutposts(this.env, repo, undefined, {});
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

  /** Hands `run` to the outpost Worker of its repo and container id. */
  run(run: Run) {
    return postRun(this.env, run);
  }

  verifyRun(worker: string, timestamp: string, body: string, signature: string) {
    return verifyRun(this.env, worker, timestamp, body, signature);
  }

  async credentials(runtimes: string[]) {
    const env: Record<string, string> = {};
    for (const runtime of runtimes) {
      const account = this.env.ACCOUNTS[runtime];
      if (!account) throw new Error(`The hub has no account for the runtime ${runtime}.`);
      for (const name of account.secrets) env[name] = await (this.env[name] as SecretsStoreSecret).get();
    }
    return env;
  }

  async runnerModule(path: string) {
    return Object.hasOwn(runnerModules, path) ? runnerModules[path]! : null;
  }

  async getState(container: string, key: string) {
    return (await this.env.FACTORY_BUCKET.get(stateKey(container, key)))?.body ?? null;
  }

  // A stream that comes over RPC has no length, and R2 needs one.
  async putState(container: string, key: string, body: ReadableStream | null, length: number) {
    if (!body) {
      await this.env.FACTORY_BUCKET.put(stateKey(container, key), null);
      return;
    }
    const { readable, writable } = new FixedLengthStream(length);
    const piped = body.pipeTo(writable);
    await Promise.all([this.env.FACTORY_BUCKET.put(stateKey(container, key), readable), piped]);
  }
}

export { BuildWatch } from "./build-watch.ts";
