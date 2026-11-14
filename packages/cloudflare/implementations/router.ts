import { ResourceGroup, scopedPhysicalName } from "@notation/resource";
import {
  generated,
  type Router as RouterContract,
  type RouterApi,
  type VaultSecret,
} from "@notation/factory";
import type { SecretGroup } from "@notation/cloudflare/secrets-store";
import { containers, kv, r2, workers } from "@notation/cloudflare/resources";
import type { fs } from "@notation/std/resources";
import * as v from "valibot";
import {
  RouterConfig,
  type RouterConfigInstance,
} from "../resources/router-config.ts";
import { kvBinding, secretBinding } from "./bindings.ts";
import { COMPATIBILITY_DATE, workerCode } from "./code.ts";
import { assertCloudflareSecret, type Vault } from "./vault.ts";

const CONTAINER_NAMESPACE = "router-container";
const CONTAINER_CLASS = "RouterContainer";

const routerConfig = v.object({
  project: v.string(),
  /**
   * The router's container image, pinned by its digest, such as
   * `registry.cloudflare.com/<account>/router@sha256:<digest>`. A new image
   * under the same tag starts no rollout.
   */
  image: v.pipe(
    v.string(),
    v.regex(/@sha256:[0-9a-f]{64}$/, "Pin the router's image by its digest"),
  ),
});
export type RouterGroupConfig = v.InferInput<typeof routerConfig>;

export type RouterOptions = RouterGroupConfig & { vault: Vault };

/**
 * `new cloudflare.Router(...)`: an always-on Worker with a `standard-1`
 * container, the project's KV namespace and R2 bucket, and the KV entry its
 * config is contributed to. Creating it generates the root key into the vault.
 */
export class Router
  extends ResourceGroup<RouterGroupConfig>
  implements RouterContract
{
  readonly project: string;
  readonly vault: Vault;
  readonly rootKey: SecretGroup;
  readonly kv: kv.KVNamespaceInstance;
  readonly bucket: r2.R2BucketInstance;
  readonly code: fs.FileInstance;
  readonly script: workers.WorkerScriptInstance;
  readonly subdomain: workers.WorkerSubdomainInstance;
  readonly container: containers.ContainerApplicationInstance;
  readonly api: RouterApi;
  readonly store: RouterConfigInstance;

  constructor(id: string, { vault, ...config }: RouterOptions) {
    const { project, image } = v.parse(routerConfig, config);
    super("cloudflare/Router", id, config);
    this.project = project;
    this.vault = vault;

    this.rootKey = vault.secret({
      id: `${id}-root-key`,
      source: generated(),
      key: "FACTORY_ROOT_KEY",
    });

    this.kv = this.add(
      new kv.KVNamespace(`${id}-kv`, {
        config: { Title: scopedPhysicalName(project, { maxLength: 512 }) },
      }),
    );
    this.bucket = this.add(
      new r2.R2Bucket(`${id}-bucket`, {
        config: {
          BucketName: scopedPhysicalName(project, { maxLength: 64 }),
          Jurisdiction: "default",
          StorageClass: "Standard",
        },
      }),
    );

    this.code = this.add(workerCode(`${id}-worker`, "router"));
    this.script = this.add(
      new workers.WorkerScript(`${id}-worker`, {
        config: {
          CompatibilityDate: COMPATIBILITY_DATE,
          // WorkerScript has no R2 binding yet, so the bucket is unbound.
          Bindings: [
            kvBinding(this.kv),
            {
              type: "durable_object_namespace",
              name: "ROUTER_CONTAINER",
              class_name: CONTAINER_CLASS,
            },
          ],
          DurableObjectNamespaces: [
            {
              id: CONTAINER_NAMESPACE,
              className: CONTAINER_CLASS,
              container: true,
            },
          ],
        },
        dependencies: { code: this.code },
      }),
    );
    this.bind("FACTORY_ROOT_KEY", this.rootKey);

    this.subdomain = this.add(
      new workers.WorkerSubdomain(`${id}-subdomain`, {
        dependencies: { script: this.script },
      }),
    );
    this.api = this.subdomain;

    this.container = this.add(
      new containers.ContainerApplication(`${id}-container`, {
        config: {
          // Cloudflare refuses an application name with two dashes in a row.
          Name: scopedPhysicalName(`${project}-router`, {
            maxLength: 253,
          }).replace(/-{2,}/g, "-"),
          HostedNamespaceId: CONTAINER_NAMESPACE,
          MaxInstances: 1,
          Configuration: { image, instance_type: "standard-1" },
        },
        dependencies: { script: this.script },
      }),
    );

    this.store = this.add(
      new RouterConfig(`${id}-config`, {
        config: { Key: "config" },
        dependencies: { kv: this.kv },
      }),
    );
  }

  bind(name: string, secret: VaultSecret): void {
    assertCloudflareSecret(secret);
    this.script.contribute({ Bindings: [secretBinding(name, secret)] });
  }
}
