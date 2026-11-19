import type { Delivery } from "./channel.ts";

/** How long the router retries a dispatch whose target is asleep or still building. */
export const RETRY_FOR_MS = 5 * 60 * 1000;

const FIRST_RETRY_MS = 2_000;
const LAST_RETRY_MS = 60_000;

/** How long the router keeps a delivery's id, and a failed delivery, after it settles. */
export const KEEP_DELIVERY_MS = 7 * 24 * 60 * 60 * 1000;

/** The wait before retry `attempt`, counting from 1: 2 seconds, doubling up to a minute. */
export const retryDelay = (attempt: number) => Math.min(LAST_RETRY_MS, FIRST_RETRY_MS * 2 ** (attempt - 1));

/**
 * One matched trigger's run, as the router hands it to the deployer.
 * `pending` dispatches are tried at `next`, or at once without it.
 */
export type TriggerDispatch = {
  trigger: string;
  run: string;
  state: "pending" | "dispatched" | "failed";
  /** The failed attempts since the dispatch was last started or replayed. */
  attempts: number;
  /** When the first of `attempts` failed. */
  since?: number;
  next?: number;
  error?: string;
  /** The channel's thread of the run's conversation, once an attempt has named it. */
  thread?: unknown;
  /**
   * The message that shows on the thread while the dispatch waits for its
   * container. The run's replies replace it. `message` is unset if the
   * channel doesn't name the messages it posts.
   */
  waiting?: { message?: string };
};

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
  /** Whether the thread has been told that the delivery failed, since it was last replayed. */
  noticed?: boolean;
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
};

/** Whether a record has no dispatch left to try. */
export const settled = (record: DeliveryRecord) => record.dispatches.every((d) => d.state !== "pending");

/** The record as an operator lists it, if one of its dispatches failed. */
export const failedDelivery = (record: DeliveryRecord, now: number): FailedDelivery | undefined => {
  const failed = record.dispatches.filter((d) => d.state === "failed");
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

/** Sets a record's failed dispatches to be tried again, each as a new run. Resolves to false if none failed. */
export const replayRecord = (record: DeliveryRecord, origin: string) => {
  const failed = record.dispatches.filter((d) => d.state === "failed");
  if (!failed.length) return false;
  for (const dispatch of failed) {
    Object.assign(dispatch, { state: "pending", run: crypto.randomUUID(), attempts: 0 });
    delete dispatch.since;
    delete dispatch.next;
    delete dispatch.error;
    delete dispatch.waiting;
  }
  record.origin = origin;
  record.noticed = false;
  return true;
};

/** The command that replays failed deliveries. */
export const REPLAY_COMMAND = "factory infra replay";

/** The one message that tells the thread a delivery's dispatch failed. `kept` says whether the router kept it for replay. */
export const failureNotice = (failed: TriggerDispatch[], kept: boolean) => {
  const lines = failed.map((d) => `Couldn't start the run of trigger \`${d.trigger}\`: ${d.error ?? "no reason given"}`);
  if (kept) lines.push(`Factory kept the event. An operator can run \`${REPLAY_COMMAND}\` to start the run again.`);
  return lines.join("\n\n");
};

/** The message that shows on the thread while a dispatch waits for its container. */
export const waitingNotice = (container: string, building: boolean) =>
  building
    ? `> Booting container \`${container}\`... Its first image build hasn't finished, so Factory will keep trying for a few minutes.`
    : `> Booting container \`${container}\`...`;
