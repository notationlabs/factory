import { DurableObject } from "cloudflare:workers";
import {
  advance,
  type DeliveryRecord,
  failedDelivery,
  heartbeatWatch,
  KEEP_DELIVERY_MS,
  LOST_AFTER_MS,
  replayRecord,
  settled,
  watch,
  type Watch,
} from "@notation/factory/router";
import { failedKey, type RouterEnv, routerStore } from "./router-store.ts";

const RECORD = "record";

/**
 * When a settled delivery was listed, if it failed. Its alarm deletes the
 * delivery `KEEP_DELIVERY_MS` later. Objects from before this held `true`,
 * which counts as listed long ago.
 */
const LISTED = "listed";

/** The prefix of each watched run's last heartbeat, as a `Watch` under `watch/<run>`. */
const WATCH = "watch/";

/**
 * One saved delivery. The router names each object by the delivery's
 * connection and id, so a delivery that arrives twice finds the first
 * one's object. The object's alarm dispatches the delivery, retries it,
 * watches its runs' heartbeats, and deletes it `KEEP_DELIVERY_MS` after it
 * settles. Alarms outlive the router's restarts, so every saved delivery is
 * dispatched.
 */
export class DeliveryInbox extends DurableObject<RouterEnv> {
  /** Saves `record` and sets the alarm to dispatch it. Resolves to false if the object has a delivery already. */
  async receive(record: DeliveryRecord) {
    if (await this.ctx.storage.get(RECORD)) return false;
    await this.ctx.storage.put(RECORD, record);
    await this.ctx.storage.setAlarm(Date.now());
    return true;
  }

  /** Dispatches the delivery's failed and lost triggers again. Resolves to false if it has none, or is still being dispatched. */
  async replay(origin: string) {
    const record = (await this.ctx.storage.get(RECORD)) as DeliveryRecord | undefined;
    if (!record || !settled(record) || !replayRecord(record, origin)) return false;
    await this.ctx.storage.put(RECORD, record);
    await this.ctx.storage.delete(LISTED);
    await this.env.FACTORY_KV.delete(failedKey(record.connection, record.id));
    await this.ctx.storage.setAlarm(Date.now());
    return true;
  }

  async record() {
    return (await this.ctx.storage.get(RECORD)) as DeliveryRecord | undefined;
  }

  /**
   * Dispatches the lost run `run` again, as a new run, while the delivery's
   * other dispatches go on. Resolves to false if the run isn't lost.
   */
  async restart(run: string, origin: string) {
    const record = (await this.ctx.storage.get(RECORD)) as DeliveryRecord | undefined;
    if (!record || !replayRecord(record, origin, run)) return false;
    await this.ctx.storage.put(RECORD, record);
    await this.ctx.storage.delete(LISTED);
    await this.env.FACTORY_KV.delete(failedKey(record.connection, record.id));
    await this.ctx.storage.setAlarm(Date.now());
    return true;
  }

  /**
   * Notes a heartbeat of `run`, and has the alarm check it within
   * `LOST_AFTER_MS`. See `heartbeatWatch`. Heartbeats are kept apart from
   * the record, so that the alarm, which saves the record after it calls
   * the deployer and channels, doesn't overwrite them.
   */
  async heartbeat(run: string, beat: { message?: string; done?: boolean }) {
    const record = (await this.ctx.storage.get(RECORD)) as DeliveryRecord | undefined;
    const key = `${WATCH}${run}`;
    const { result, watch } = heartbeatWatch(record, run, (await this.ctx.storage.get(key)) as Watch | undefined, beat, Date.now());
    if (!watch) return result;
    await this.ctx.storage.put(key, watch);
    if ("done" in watch) return result;
    const check = watch.at + LOST_AFTER_MS;
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > check) await this.ctx.storage.setAlarm(check);
    return result;
  }

  /**
   * 1. Tries the delivery's due dispatches.
   * 2. Marks lost the dispatched runs whose last heartbeat is
   *    `LOST_AFTER_MS` old, and stops watching them.
   * 3. Sets the alarm for the next retry or heartbeat check, while the
   *    delivery isn't settled.
   * 4. Once it settles, and again when a run is lost, lists the delivery as
   *    failed if a dispatch failed or was lost. A retried alarm that finds
   *    the delivery settled but not listed lists it again.
   * 5. Deletes the delivery `KEEP_DELIVERY_MS` after it was listed, once no
   *    run is watched.
   */
  async alarm() {
    const record = (await this.ctx.storage.get(RECORD)) as DeliveryRecord | undefined;
    if (!record) return;
    const store = await routerStore(this.env);
    const wake = settled(record) ? undefined : await advance(record, store);
    const watches = new Map<string, Watch>();
    const stored = (await this.ctx.storage.list({ prefix: WATCH })) as Map<string, Watch>;
    for (const [key, beat] of stored) watches.set(key.slice(WATCH.length), beat);
    const { forget, next, lost } = await watch(record, watches, store);
    await this.ctx.storage.put(RECORD, record);
    if (forget.length) await this.ctx.storage.delete(forget.map((run) => `${WATCH}${run}`));
    if (wake !== undefined) {
      await this.ctx.storage.setAlarm(next === undefined ? wake : Math.min(wake, next));
      return;
    }
    const now = Date.now();
    const saved = (await this.ctx.storage.get(LISTED)) as number | true | undefined;
    let listed = saved === true ? 0 : saved;
    if (listed === undefined || lost) {
      const failed = failedDelivery(record, now);
      if (failed) {
        await this.env.FACTORY_KV.put(failedKey(record.connection, record.id), JSON.stringify(failed), {
          expirationTtl: KEEP_DELIVERY_MS / 1000,
        });
      }
      listed = now;
      await this.ctx.storage.put(LISTED, listed);
    } else if (next === undefined && now >= listed + KEEP_DELIVERY_MS) {
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.setAlarm(next === undefined ? listed + KEEP_DELIVERY_MS : Math.min(listed + KEEP_DELIVERY_MS, next));
  }
}
