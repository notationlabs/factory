import type { Run } from "@notation/factory/router";

/** What an outpost Worker calls on the hub's deployer, over its service binding. */
export type DeployerService = {
  /** Whether `signature` is the deployer's signature of a run for the outpost Worker `worker`. */
  verifyRun(worker: string, timestamp: string, body: string, signature: string): Promise<boolean>;
  /** The secrets of the accounts of `runtimes`, and the outpost secrets that allow `repo`, by the env var names that containers read them as. */
  credentials(runtimes: string[], repo: string): Promise<Record<string, string>>;
  /** The source of the hub's runner module at `path`, such as `runtimes/claude.ts`, or null if it has none. */
  runnerModule(path: string): Promise<string | null>;
  getState(container: string, key: string): Promise<ReadableStream | null>;
  /** Stores `length` bytes of `body`. */
  putState(container: string, key: string, body: ReadableStream | null, length: number): Promise<void>;
};

/** The headers that the deployer signs a run with. */
export const RUN_HEADERS = { timestamp: "x-factory-timestamp", signature: "x-factory-signature" } as const;

/** The class of an outpost Worker's container, which its `wrangler.json` names. */
export const CONTAINER_CLASS = "OutpostContainer";

/**
 * The name of the Durable Object that takes `run`, which has its own
 * container: one for each branch worktree, and one for each conversation's
 * scratch worktree. Runs in the same worktree queue in its container.
 */
export const instanceName = (run: Pick<Run, "worktree" | "conversation">) =>
  run.worktree ? `worktree:${run.worktree.branch}` : `scratch:${run.conversation.id}`;

/**
 * The name of the Durable Object whose id keys the state store of every
 * container of an outpost Worker. It was the only Durable Object before
 * each worktree had its own, so the state it saved stays where it was.
 */
export const STATE_INSTANCE = "outpost";

/** How long a run waits for a free container instance before it fails. GitHub's clone token in the run lasts an hour. */
export const CAPACITY_WAIT_MS = 30 * 60 * 1000;

/** How long a run waits between tries to get a container instance. */
export const CAPACITY_RETRY_S = 60;

/**
 * Whether `error`, from starting a container, means Cloudflare has no
 * instance for it now: the Worker has `max_instances` containers running,
 * the account is at its limits, the image is still provisioning, or
 * containers start too fast.
 */
export const isCapacityError = (error: unknown) => {
  const text = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    text.includes("there is no container instance that can be provided") ||
    text.includes("you are requesting too many containers per second")
  );
};

/** What a run that waits for a free container instance posts once. */
export const capacityNotice = (container: string, maxInstances: number) =>
  `> No instance of the container \`${container}\` is free. It runs at most ${maxInstances} at once, one for each worktree, or Cloudflare may still be provisioning it. This run waits up to ${CAPACITY_WAIT_MS / 60_000} minutes for one.`;

/** What a run that found no free container instance in time posts. */
export const capacityFailure = (container: string, maxInstances: number) =>
  `The container \`${container}\` had no free instance for ${CAPACITY_WAIT_MS / 60_000} minutes, so this run didn't start. It runs at most ${maxInstances} at once (\`maxInstances\` on the deployer). Mention the agent again to try again.`;
