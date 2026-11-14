import { randomBytes } from "node:crypto";
import { Redacted, type Source } from "@notation/std/sources";

/**
 * A source of random values, such as a root key. Each secret that uses it
 * gets its own value, `bytes` random bytes in hex. The version never changes,
 * so the value is written once, when the secret is created, and again only
 * if the secret is recreated after drift. The key is not used.
 */
export const generated = (bytes = 32): Source => ({
  name: "generated",
  has: async () => true,
  version: async () => "1",
  get: async () => new Redacted(randomBytes(bytes).toString("hex")),
});
