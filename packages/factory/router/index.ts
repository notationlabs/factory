export type {
  ChannelEntry,
  ConnectionEntry,
  OutpostConfig,
  RouterConfig,
  TriggerEntry,
} from "../contracts/index.ts";

/** The KV key that the deployer stores a repo's outpost config under. `repo` is `owner/name`. */
export const outpostKey = (repo: string) => `outposts/${repo.toLowerCase()}`;

const encoder = new TextEncoder();

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );

/** HMAC-SHA256 of `message` with `key`, as lower-case hex. */
export const hmacHex = async (key: string, message: string | Uint8Array<ArrayBuffer>) => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = typeof message === "string" ? encoder.encode(message) : message;
  return hex(await crypto.subtle.sign("HMAC", cryptoKey, data));
};

/**
 * Derives a key from the root key. `purpose` names what the key is for, such
 * as `github:webhook:<App id>`, so that no two purposes share a key.
 */
export const deriveKey = (rootKey: string, purpose: string) =>
  hmacHex(rootKey, purpose);

/** Compares two strings in time that depends only on their lengths. */
export const timingSafeEqual = (a: string, b: string) => {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
};
