import { hmacHex, timingSafeEqual } from "./keys.ts";

/** The header of a `POST /sync` request: `<time in milliseconds>.<signature>`. */
export const SYNC_HEADER = "x-factory-sync";

/** How far a sync request's time may be from the router's clock. */
export const SYNC_MAX_SKEW_MS = 5 * 60 * 1000;

// The signature covers the router's origin, so a captured header works only for that router.
const signature = (syncKey: string, origin: string, at: number) => hmacHex(syncKey, `sync:${at}:${origin}`);

/** The `SYNC_HEADER` value of a sync request to the router at `origin`, made at `at`. */
export const signSync = async (syncKey: string, origin: string, at = Date.now()) =>
  `${at}.${await signature(syncKey, origin, at)}`;

/** Whether `header` was signed with the sync key for the router at `origin`, close enough to `now`. */
export const verifySync = async (syncKey: string, header: string, origin: string, now = Date.now()) => {
  const [at, signed, ...rest] = header.split(".");
  if (!at || !signed || rest.length || !/^\d+$/.test(at)) return false;
  if (Math.abs(now - Number(at)) > SYNC_MAX_SKEW_MS) return false;
  return timingSafeEqual(signed, await signature(syncKey, origin, Number(at)));
};
