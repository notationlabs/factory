import { ResourceGroup } from "@notation/resource";
import {
  bindingName,
  RandomKey,
  type RandomKeyInstance,
  type Router as RouterContract,
  type RouterApi,
  scopedName,
  type VaultSecret,
} from "@notation/factory";
import { kvJson, type KVJsonGroup } from "@notation/cloudflare/kv";
import { containers, kv, r2, workers } from "@notation/cloudflare/resources";
import type { fs } from "@notation/std/resources";
import * as v from "valibot";
import {
  ROUTER_CONFIG_KEY,
  RouterConfigSchema,
} from "../lib/router-config.ts";
import { kvBinding, r2Binding, secretBinding } from "./bindings.ts";
import { COMPATIBILITY_DATE, routerImageContext, workerCode } from "./code.ts";
import {
  assertCloudflareSecret,
  type CloudflareSecret,
  type Vault,
} from "./vault.ts";

const CONTAINER_NAMESPACE = "router-container";
const CONTAINER_CLASS = "RouterContainer";

const routerConfig = v.object({
  project: v.string(),
});
export type RouterGroupConfig = v.InferInput<typeof routerConfig>;

export type RouterOptions = RouterGroupConfig & { vault: Vault };

/**
 * `new cloudflare.Router(...)`: an always-on Worker with a `standard-1`
 * container built from the image this package ships, the project's KV
 * namespace and R2 bucket, and the KV entry its config is contributed to.
 * It generates the root key, and keeps it in the vault.
 */
export class Router
  extends ResourceGroup<RouterGroupConfig>
  implements RouterContract
{
  readonly project: string;
  readonly vault: Vault;
  readonly rootKeyValue: RandomKeyInstance;
  readonly rootKey: CloudflareSecret;
  readonly kv: kv.KVNamespaceInstance;
  readonly bucket: r2.R2BucketInstance;
  readonly code: fs.FileInstance;
  readonly script: workers.WorkerScriptInstance;
  readonly subdomain: workers.WorkerSubdomainInstance;
  readonly image: containers.ContainerImageInstance;
  readonly container: containers.ContainerApplicationInstance;
  readonly api: RouterApi;
  readonly store: KVJsonGroup<typeof RouterConfigSchema>;

  constructor(id: string, { vault, ...config }: RouterOptions) {
    const { project } = v.parse(routerConfig, config);
    super("cloudflare/Router", id, config);
    this.project = project;
    this.vault = vault;

    this.rootKeyValue = this.add(
      new RandomKey(`${id}-root-key`, { config: { Bytes: 32 } }),
    );
    this.rootKey = vault.secret({
      id: `${id}-root-key`,
      value: this.rootKeyValue.credentials.Value,
    });

    this.kv = this.add(
      new kv.KVNamespace(`${id}-kv`, {
        config: { Title: scopedName(project, 512) },
      }),
    );
    this.bucket = this.add(
      new r2.R2Bucket(`${id}-bucket`, {
        config: {
          BucketName: scopedName(project, 64),
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
          Bindings: [
            kvBinding(this.kv),
            r2Binding(this.bucket),
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
    this.bind(this.rootKey, "FACTORY_ROOT_KEY");

    this.subdomain = this.add(
      new workers.WorkerSubdomain(`${id}-subdomain`, {
        dependencies: { script: this.script },
      }),
    );
    this.api = this.subdomain;

    // The tag is a hash of the build context, so every project shares one
    // repository.
    this.image = this.add(
      new containers.ContainerImage(`${id}-image`, {
        config: { Repository: "factory-router", Context: routerImageContext() },
      }),
    );

    this.container = this.add(
      new containers.ContainerApplication(`${id}-container`, {
        config: {
          // Cloudflare refuses an application name with two dashes in a row.
          Name: scopedName(`${project}-router`, 253).replace(/-{2,}/g, "-"),
          HostedNamespaceId: CONTAINER_NAMESPACE,
          MaxInstances: 1,
          Configuration: {
            image: this.image.outputRef("Image"),
            instance_type: "standard-1",
          },
        },
        dependencies: { script: this.script },
      }),
    );

    this.store = this.add(
      kvJson({
        id: `${id}-config`,
        namespace: this.kv,
        key: ROUTER_CONFIG_KEY,
        schema: RouterConfigSchema,
      }),
    );
  }

  bind(secret: VaultSecret, name = bindingName(secret.id)): string {
    assertCloudflareSecret(secret);
    this.script.contribute({ Bindings: [secretBinding(name, secret)] });
    return name;
  }
}
