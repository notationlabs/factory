import { ResourceGroup, scopedPhysicalName } from "@notation/resource";
import {
  bindingName,
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
import { kvBinding, r2Binding, secretBinding } from "./bindings.ts";
import { COMPATIBILITY_DATE, routerImageContext, workerCode } from "./code.ts";
import { assertCloudflareSecret, type Vault } from "./vault.ts";

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
 * namespace and R2 bucket, and the KV entry its
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
  readonly image: containers.ContainerImageInstance;
  readonly container: containers.ContainerApplicationInstance;
  readonly api: RouterApi;
  readonly store: RouterConfigInstance;

  constructor(id: string, { vault, ...config }: RouterOptions) {
    const { project } = v.parse(routerConfig, config);
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
          Name: scopedPhysicalName(`${project}-router`, {
            maxLength: 253,
          }).replace(/-{2,}/g, "-"),
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
      new RouterConfig(`${id}-config`, {
        config: { Key: "config" },
        dependencies: { kv: this.kv },
      }),
    );
  }

  bind(secret: VaultSecret, name = bindingName(secret.id)): string {
    assertCloudflareSecret(secret);
    this.script.contribute({ Bindings: [secretBinding(name, secret)] });
    return name;
  }
}
