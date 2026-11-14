import type { BindableSecret } from "@notation/cloudflare/secrets-store";
import type { kv, workers } from "@notation/cloudflare/resources";

type WorkerBinding = workers.WorkerBinding;

/** The name that the hub's Workers read the project's KV namespace as. */
export const KV_BINDING = "FACTORY_KV";

export const kvBinding = (namespace: kv.KVNamespaceInstance): WorkerBinding => ({
  type: "kv_namespace",
  name: KV_BINDING,
  namespace_id: namespace.outputRef("NamespaceId"),
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

// WorkerScript has no JSON binding, so each var is a plain text binding that
// holds JSON. The Worker parses it.
export const varBindings = (vars: Record<string, unknown>): WorkerBinding[] =>
  Object.entries(vars).map(([name, value]) => ({
    type: "plain_text",
    name,
    text: JSON.stringify(value),
  }));
