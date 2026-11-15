// The parts of the Workers runtime the hub's Workers use. The full types,
// @cloudflare/workers-types, replace Node's globals, which the rest of the
// repo type-checks against.

export type KVNamespace = {
  get(key: string, type: "json"): Promise<unknown>;
  get(key: string): Promise<string | null>;
};

export type SecretsStoreSecret = { get(): Promise<string> };
