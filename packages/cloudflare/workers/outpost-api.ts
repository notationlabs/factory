/** What an outpost Worker calls on the hub's deployer, over its service binding. */
export type DeployerService = {
  /** Whether `signature` is the deployer's signature of a run for the outpost Worker `worker`. */
  verifyRun(worker: string, timestamp: string, body: string, signature: string): Promise<boolean>;
  /** The secrets of the accounts of `runtimes`, by the env var names that containers read them as. */
  credentials(runtimes: string[]): Promise<Record<string, string>>;
  getState(container: string, key: string): Promise<ReadableStream | null>;
  /** Stores `length` bytes of `body`. */
  putState(container: string, key: string, body: ReadableStream | null, length: number): Promise<void>;
};

/** The headers that the deployer signs a run with. */
export const RUN_HEADERS = { timestamp: "x-factory-timestamp", signature: "x-factory-signature" } as const;

/** The class of an outpost Worker's container, which its `wrangler.json` names. */
export const CONTAINER_CLASS = "OutpostContainer";
