import { type OutputRef, ResourceGroup } from "@notation/resource";
import type { CodeHost } from "@notation/factory";
import {
  bindingName,
  RandomKey,
  RouterSync,
  type RandomKeyInstance,
  type Router as RouterContract,
  type RouterChannelOptions,
  scopedName,
  type VaultSecret,
} from "@notation/factory";
import { kvJson, type KVJsonGroup } from "@notation/cloudflare/kv";
import { kv, r2 } from "@notation/cloudflare/resources";
import {
  addBindings,
  type Bindings,
  type Worker,
  worker,
} from "@notation/cloudflare/workers";
import {
  ROUTER_CONFIG_KEY,
  RouterConfigSchema,
} from "../lib/router-config.ts";
import { KV_BINDING, R2_BINDING } from "./bindings.ts";
import { COMPATIBILITY_DATE, workerBundle } from "./code.ts";
import {
  assertCloudflareSecret,
  type CloudflareSecret,
  type Vault,
} from "./vault.ts";

export type RouterOptions = { vault: Vault };

/** A Worker id from `parts`: lowercase letters, digits and single hyphens. */
const workerId = (...parts: string[]) =>
  parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * `new cloudflare.Router(...)`: a Worker, the hub's KV namespace and R2
 * bucket, and the KV entry its config is contributed to. It generates the
 * root key, and keeps it in the vault. Each connection's channel is a Worker
 * of its own, which the router binds as a service.
 */
export class Router extends ResourceGroup implements RouterContract {
  readonly vault: Vault;
  readonly rootKeyValue: RandomKeyInstance;
  readonly rootKey: CloudflareSecret;
  codeHost?: CodeHost;
  readonly kv: kv.KVNamespaceInstance;
  readonly bucket: r2.R2BucketInstance;
  readonly worker: Worker;
  readonly url: OutputRef<string>;
  readonly store: KVJsonGroup<typeof RouterConfigSchema>;
  /** The bundle of each provider's channel, which its connections share. */
  readonly #channelBundles = new Map<
    string,
    { module: string; bundle: ReturnType<typeof workerBundle> }
  >();

  constructor(id: string, { vault }: RouterOptions) {
    super("cloudflare/Router", id);
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
        config: { Title: scopedName(id, 512) },
      }),
    );
    this.bucket = this.add(
      new r2.R2Bucket(`${id}-bucket`, {
        config: {
          BucketName: scopedName(workerId(id), 64),
          Jurisdiction: "default",
          StorageClass: "Standard",
        },
      }),
    );

    const router = worker({
      id: workerId(id),
      compatibilityDate: COMPATIBILITY_DATE,
      code: workerBundle(`${id}-router`, "router"),
      bindings: () => ({
        [KV_BINDING]: this.kv,
        [R2_BINDING]: this.bucket,
        FACTORY_ROOT_KEY: this.rootKey.secret,
      }),
    });
    this.worker = router;
    this.url = router.url;

    this.store = this.add(
      kvJson({
        id: `${id}-config`,
        namespace: this.kv,
        key: ROUTER_CONFIG_KEY,
        schema: RouterConfigSchema,
        // A hub with no connections and no operator auth contributes nothing.
        value: {},
      }),
    );

    this.add(
      new RouterSync(`${id}-sync`, {
        config: {
          Url: this.url,
          Config: this.store.value
            .outputRef("Value")
            .map((value) => JSON.stringify(value)),
        },
      }),
    );
  }

  bind(secret: VaultSecret, name = bindingName(secret.id)): string {
    assertCloudflareSecret(secret);
    addBindings(this.worker, { [name]: secret.secret });
    return name;
  }

  /**
   * Runs the connection's channel as a Worker with no URL, which binds the
   * channel's secrets and values under their own names. The router binds
   * it as `CHANNEL_<connection>`.
   */
  channel({ connection, module, secrets = {}, values = {} }: RouterChannelOptions) {
    const provider = connection.split("/")[0]!;
    const code = this.#channelBundle(provider, module);
    const bindings: Bindings = { ...values };
    for (const [name, secret] of Object.entries(secrets)) {
      assertCloudflareSecret(secret);
      bindings[name] = secret.secret;
    }
    const channel = worker({
      id: workerId(this.id, connection),
      compatibilityDate: COMPATIBILITY_DATE,
      code,
      url: false,
      bindings: () => bindings,
    });
    const name = `CHANNEL_${bindingName(connection)}`;
    addBindings(this.worker, { [name]: channel });
    this.store.contribute({ connections: { [connection]: { channel: name } } });
  }

  #channelBundle(provider: string, module: string) {
    const existing = this.#channelBundles.get(provider);
    if (existing) {
      if (existing.module !== module) {
        throw new Error(
          `The router ${this.id} runs the ${provider} channel from ${existing.module}, so it can't also run one from ${module}.`,
        );
      }
      return existing.bundle;
    }
    const bundle = workerBundle(`${this.id}-channel-${provider}`, "channel", {
      "factory:channel": `export { channel } from ${JSON.stringify(module)};`,
    });
    this.#channelBundles.set(provider, { module, bundle });
    return bundle;
  }
}
