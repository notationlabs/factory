import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import type { Router as RouterContract } from "factory";
import * as v from "valibot";
import { KvNamespace } from "../resources/kv.ts";
import { RouterConfig, type RouterConfigInstance } from "../resources/router-config.ts";
import { Worker, type WorkerInstance } from "../resources/worker.ts";

const routerConfig = v.object({ name: v.string() });
export type RouterOptions = ResourceOpts<v.InferInput<typeof routerConfig>, {}>;

/** `new cloudflare.Router(...)`: a Worker, and the KV entry its config is contributed to. */
export class Router extends ResourceGroup implements RouterContract {
  readonly api: WorkerInstance;
  readonly store: RouterConfigInstance;

  constructor({ id, config }: RouterOptions) {
    const { name } = v.parse(routerConfig, config);
    super("cloudflare/Router", { name });
    const kv = this.add(
      new KvNamespace({ id: `${id}-kv`, config: { title: `${name}-config` } }),
    );
    this.api = this.add(
      new Worker({
        id: `${id}-worker`,
        config: { ScriptName: name },
        dependencies: { kv },
      }),
    );
    this.store = this.add(
      new RouterConfig({
        id: `${id}-config`,
        config: { key: "config" },
        dependencies: { kv },
      }),
    );
  }
}
