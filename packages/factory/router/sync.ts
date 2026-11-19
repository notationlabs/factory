import { hmacHex, timingSafeEqual } from "./keys.ts";

/** The header of a `POST /sync` request: `<time in milliseconds>.<signature>`. */
export const SYNC_HEADER = "x-factory-sync";

/** How far a sync request's time may be from the router's clock. */
export const SYNC_MAX_SKEW_MS = 5 * 60 * 1000;

const signature = (syncKey: string, at: number) => hmacHex(syncKey, `sync:${at}`);

/** The `SYNC_HEADER` value of a sync request made at `at`. */
export const signSync = async (syncKey: string, at = Date.now()) => `${at}.${await signature(syncKey, at)}`;

/** Whether `header` was signed with the sync key, close enough to `now`. */
export const verifySync = async (syncKey: string, header: string, now = Date.now()) => {
  const [at, signed, ...rest] = header.split(".");
  if (!at || !signed || rest.length || !/^\d+$/.test(at)) return false;
  if (Math.abs(now - Number(at)) > SYNC_MAX_SKEW_MS) return false;
  return timingSafeEqual(signed, await signature(syncKey, Number(at)));
};
