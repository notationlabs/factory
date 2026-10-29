import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import { type Router as RouterContract, secret } from "lightbox";
import * as v from "valibot";
import { KvNamespace, type KvNamespaceInstance } from "../resources/kv.ts";
import { R2Bucket, type R2BucketInstance } from "../resources/r2.ts";
import {
  RouterConfig,
  type RouterConfigInstance,
} from "../resources/router-config.ts";
import { Worker, type WorkerInstance } from "../resources/worker.ts";
import type { Vault } from "./vault.ts";

const routerConfig = v.object({ project: v.string() });
export type RouterGroupConfig = v.InferInput<typeof routerConfig>;

export type RouterOptions = ResourceOpts<RouterGroupConfig, { vault: Vault }>;

/**
 * `new cloudflare.Router(...)`: an always-on Worker with a `standard-1`
 * container, the project's KV namespace and R2 bucket, and the KV entry its
 * config is contributed to. Creating it generates the root key into the vault.
 */
export class Router
  extends ResourceGroup<RouterGroupConfig, { vault: Vault }>
  implements RouterContract
{
  readonly project: string;
  readonly vault: Vault;
  readonly kv: KvNamespaceInstance;
  readonly bucket: R2BucketInstance;
  readonly api: WorkerInstance;
  readonly store: RouterConfigInstance;

  constructor({ id, config, dependencies }: RouterOptions) {
    const { project } = v.parse(routerConfig, config);
    super("cloudflare/Router", { id, config, dependencies });
    this.project = project;
    this.vault = dependencies.vault;
    this.kv = this.add(
      new KvNamespace({ id: `${id}-kv`, config: { title: project } }),
    );
    this.bucket = this.add(
      new R2Bucket({ id: `${id}-bucket`, config: { name: project } }),
    );
    this.vault.secret({
      id: `${id}-root-key`,
      name: "LIGHTBOX_ROOT_KEY",
      value: secret.generated(),
    });
    this.api = this.add(
      new Worker({
        id: `${id}-worker`,
        config: {
          ScriptName: `${project}-router`,
          ContainerInstanceType: "standard-1",
        },
        dependencies: {
          kv: this.kv,
          store: this.vault.store,
          bucket: this.bucket,
        },
      }),
    );
    this.store = this.add(
      new RouterConfig({
        id: `${id}-config`,
        config: { key: "config" },
        dependencies: { kv: this.kv },
      }),
    );
  }
}
