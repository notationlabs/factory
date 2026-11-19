import { DurableObject } from "cloudflare:workers";
import {
  advance,
  type DeliveryRecord,
  failedDelivery,
  KEEP_DELIVERY_MS,
  replayRecord,
  settled,
} from "@notation/factory/router";
import { failedKey, type RouterEnv, routerStore } from "./router-store.ts";

const RECORD = "record";

/**
 * One saved delivery. The router names each object by the delivery's
 * connection and id, so a delivery that arrives twice finds the first
 * one's object. The object's alarm dispatches the delivery, retries it, and
 * deletes it `KEEP_DELIVERY_MS` after it settles. Alarms outlive the
 * router's restarts, so every saved delivery is dispatched.
 */
export class DeliveryInbox extends DurableObject<RouterEnv> {
  /** Saves `record` and sets the alarm to dispatch it. Resolves to false if the object has a delivery already. */
  async receive(record: DeliveryRecord) {
    if (await this.ctx.storage.get(RECORD)) return false;
    await this.ctx.storage.put(RECORD, record);
    await this.ctx.storage.setAlarm(Date.now());
    return true;
  }

  /** Dispatches the delivery's failed triggers again. Resolves to false if it has none, or is still being dispatched. */
  async replay(origin: string) {
    const record = (await this.ctx.storage.get(RECORD)) as DeliveryRecord | undefined;
    if (!record || !settled(record) || !replayRecord(record, origin)) return false;
    await this.ctx.storage.put(RECORD, record);
    await this.env.FACTORY_KV.delete(failedKey(record.connection, record.id));
    await this.ctx.storage.setAlarm(Date.now());
    return true;
  }

  /**
   * Tries the delivery's due dispatches, and sets the alarm for the next
   * retry. Once the delivery settles, lists it as failed if a dispatch
   * failed, and sets the alarm that deletes it.
   */
  async alarm() {
    const record = (await this.ctx.storage.get(RECORD)) as DeliveryRecord | undefined;
    if (!record) return;
    if (settled(record)) {
      await this.ctx.storage.deleteAll();
      return;
    }
    const wake = await advance(record, await routerStore(this.env));
    await this.ctx.storage.put(RECORD, record);
    if (wake !== undefined) {
      await this.ctx.storage.setAlarm(wake);
      return;
    }
    const failed = failedDelivery(record, Date.now());
    if (failed) {
      await this.env.FACTORY_KV.put(failedKey(record.connection, record.id), JSON.stringify(failed), {
        expirationTtl: KEEP_DELIVERY_MS / 1000,
      });
    }
    await this.ctx.storage.setAlarm(Date.now() + KEEP_DELIVERY_MS);
  }
}
