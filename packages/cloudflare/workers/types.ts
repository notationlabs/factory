// The parts of the Workers runtime the hub's Workers use. The full types,
// @cloudflare/workers-types, replace Node's globals, which the rest of the
// repo type-checks against.

export type KVNamespace = {
  get(key: string, type: "json"): Promise<unknown>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

export type SecretsStoreSecret = { get(): Promise<string> };

export type R2Bucket = {
  get(key: string): Promise<{ body: ReadableStream } | null>;
  /** A stream must have a known length, such as a request's body with `content-length`. */
  put(key: string, value: ReadableStream | null): Promise<unknown>;
};

type LoadedWorker = {
  getEntrypoint(): { fetch(request: Request): Promise<Response> };
};

/** The Worker Loader binding: runs code given at runtime in an isolate of its own. */
export type WorkerLoader = {
  get(
    id: string,
    code: () => {
      compatibilityDate: string;
      compatibilityFlags?: string[];
      mainModule: string;
      modules: Record<string, string | { js: string }>;
      /** `null` blocks the isolate's network access. */
      globalOutbound: null;
      env: Record<string, unknown>;
    },
  ): LoadedWorker;
};
