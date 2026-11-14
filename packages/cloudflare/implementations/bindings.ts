import type { BindableSecret } from "@notation/cloudflare/secrets-store";
import type { kv, r2, workers } from "@notation/cloudflare/resources";

type WorkerBinding = workers.WorkerBinding;

/** The name that the hub's Workers read the project's KV namespace as. */
export const KV_BINDING = "FACTORY_KV";

export const kvBinding = (namespace: kv.KVNamespaceInstance): WorkerBinding => ({
  type: "kv_namespace",
  name: KV_BINDING,
  namespace_id: namespace.outputRef("NamespaceId"),
});

/** The name that the router reads the project's R2 bucket as. */
export const R2_BINDING = "FACTORY_BUCKET";

// The output ref makes the Worker depend on the bucket.
export const r2Binding = (bucket: r2.R2BucketInstance): WorkerBinding => ({
  type: "r2_bucket",
  name: R2_BINDING,
  bucket_name: bucket.outputRef("BucketName"),
});

// The output refs make the Worker depend on the secret, so the secret exists
// when the Worker is uploaded.
export const secretBinding = (
  name: string,
  secret: BindableSecret,
): WorkerBinding => {
  const reference = secret["~secret"]();
  return {
    type: "secrets_store_secret",
    name,
    store_id: reference.outputRef("StoreId"),
    secret_name: reference.outputRef("Name"),
  };
};

export const jsonBindings = (vars: Record<string, unknown>): WorkerBinding[] =>
  Object.entries(vars).map(([name, json]) => ({ type: "json", name, json }));
