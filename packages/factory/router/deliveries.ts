import type { Delivery } from "./channel.ts";
import { LOST_AFTER_MS } from "./run.ts";

/** How often the router tries again a dispatch whose container's first image build hasn't finished. */
export const BUILD_POLL_MS = 30_000;

/**
 * How long a dispatch waits for its container's first image build. The
 * deployer reports a build that hasn't finished within 2 hours as failed,
 * so this only applies when that report never arrives.
 */
export const BUILD_WAIT_MS = 3 * 60 * 60 * 1000;

/** How long the router keeps a delivery's id, and a failed delivery, after it settles. */
export const KEEP_DELIVERY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One matched trigger's run, as the router hands it to the deployer.
 * `pending` dispatches are tried at `next`, or at once without it. A
 * `dispatched` run that stops sending heartbeats becomes `lost`.
 */
export type TriggerDispatch = {
  trigger: string;
  run: string;
  state: "pending" | "dispatched" | "failed" | "lost";
  /** When the dispatch started to wait for its container's first image build. */
  since?: number;
  next?: number;
  error?: string;
  /** The channel's thread of the run's conversation, once an attempt has named it. */
  thread?: unknown;
  /**
   * The id of the message that shows on the thread while the dispatch waits
   * for the build, or the lost notice of a lost run. The run's first reply,
   * or the failure notice, replaces it.
   */
  waiting?: string;
};

/**
 * A run's last heartbeat, which the inbox keeps apart from its record.
 * `at` is in ms since the epoch. `message` is the id of the message that
 * the run's replies replace, which the lost notice replaces too.
 */
export type Watch = { at: number; message?: string };

/**
 * A verified delivery that matched triggers whose authors may start runs,
 * as the router saves it. `id` is the delivery's id, or a random id if the
 * platform gave none. The router never saves a `Run`, whose tokens expire:
 * each attempt mints new ones.
 */
export type DeliveryRecord = {
  id: string;
  /** The delivery's connection, such as `github/gh`. */
  connection: string;
  delivery: Delivery<unknown>;
  /** The router's origin, which runs reply to. */
  origin: string;
  received: number;
  acknowledged?: boolean;
  dispatches: TriggerDispatch[];
};

/** A delivery whose dispatch failed after its retries, as an operator lists it. */
export type FailedDelivery = {
  connection: string;
  id: string;
  repo: string;
  event: string;
  received: number;
  failed: number;
  triggers: { trigger: string; error?: string }[];
};

/**
 * Where the router keeps deliveries. Each platform adapts its own storage
 * to it, and runs `advance` on each saved delivery until it settles,
 * including after the router restarts.
 */
export type Inbox = {
  /** Saves `record`, and starts dispatching it. Resolves to false, and does nothing, if the inbox has a delivery with its connection and id. */
  receive(record: DeliveryRecord): Promise<boolean>;
  /** The deliveries whose dispatch failed after its retries, kept for `KEEP_DELIVERY_MS`. */
  failed(): Promise<FailedDelivery[]>;
  /**
   * Dispatches the failed triggers of a failed delivery again, against the
   * outpost config that its repo has now. Runs reply to `origin`. Resolves
   * to false if the inbox has no such failed delivery.
   */
  replay(connection: string, id: string, origin: string): Promise<boolean>;
  /**
   * Notes a heartbeat of the run `run` of a delivery, or with `done`, stops
   * watching the run. Resolves to `unknown` if the delivery has no such
   * run, and to `lost` if the run was marked lost.
   */
  heartbeat(connection: string, id: string, run: string, beat: { message?: string; done?: boolean }): Promise<"ok" | "lost" | "unknown">;
  /** The delivery with this connection and id, if the inbox has it. */
  record(connection: string, id: string): Promise<DeliveryRecord | undefined>;
  /**
   * Dispatches the lost run `run` of a delivery again, as a new run that
   * replies to `origin`. Resolves to false if the delivery has no such lost
   * run, such as when someone restarted it already.
   */
  restart(connection: string, id: string, run: string, origin: string): Promise<boolean>;
};

/** Whether a record has no dispatch left to try. */
export const settled = (record: DeliveryRecord) => record.dispatches.every((d) => d.state !== "pending");

const isFailed = (d: TriggerDispatch) => d.state === "failed" || d.state === "lost";

/** The record as an operator lists it, if one of its dispatches failed or was lost. */
export const failedDelivery = (record: DeliveryRecord, now: number): FailedDelivery | undefined => {
  const failed = record.dispatches.filter(isFailed);
  if (!failed.length) return undefined;
  return {
    connection: record.connection,
    id: record.id,
    repo: record.delivery.repo,
    event: record.delivery.event,
    received: record.received,
    failed: now,
    triggers: failed.map((d) => ({ trigger: d.trigger, ...(d.error && { error: d.error }) })),
  };
};

/**
 * Sets a record's failed and lost dispatches to be tried again, each as a
 * new run, or with `run`, only that lost run. Resolves to false if there was
 * none. A lost run's new run replaces the lost notice.
 */
export const replayRecord = (record: DeliveryRecord, origin: string, run?: string) => {
  const failed = record.dispatches.filter((d) => (run === undefined ? isFailed(d) : d.run === run && d.state === "lost"));
  if (!failed.length) return false;
  for (const dispatch of failed) {
    if (dispatch.state !== "lost") delete dispatch.waiting;
    Object.assign(dispatch, { state: "pending", run: crypto.randomUUID() });
    delete dispatch.since;
    delete dispatch.next;
    delete dispatch.error;
  }
  record.origin = origin;
  return true;
};

/** The command that replays failed deliveries. */
export const REPLAY_COMMAND = "factory infra replay";

/** The message that tells the thread that a dispatch failed. */
export const failureNotice = (failed: TriggerDispatch) =>
  `Couldn't start the run of trigger \`${failed.trigger}\`: ${failed.error ?? "no reason given"}\n\n` +
  `Factory kept the event. An operator can run \`${REPLAY_COMMAND}\` to start the run again.`;

/** Why a lost dispatch failed, as operators list it. */
export const LOST_ERROR = `The run sent no heartbeat for ${LOST_AFTER_MS / 60_000} minutes.`;

/**
 * The message that replaces a lost run's message on the thread. `restart`
 * is the link that restarts the run.
 */
export const lostNotice = (restart: string) =>
  `This run sent no heartbeat for ${LOST_AFTER_MS / 60_000} minutes, so Factory marked it as lost. Its container may have stopped or run out of memory.\n\n` +
  `[Restart the run](${restart}), or mention the agent again. The link works for ${KEEP_DELIVERY_MS / 86_400_000} days, for anyone who may trigger the agent. ` +
  "A new run starts from the worktree and session as this run last saved them, up to a minute before it was lost.";

/** The message that shows on the thread while a dispatch waits for its container's first image build. */
export const waitingNotice = (container: string) => `> Booting container \`${container}\`...`;
