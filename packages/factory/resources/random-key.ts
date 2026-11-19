import { randomBytes, randomUUID } from "node:crypto";
import { resource } from "@notation/resource";
import * as v from "valibot";

type RandomKeyApi = {
  Key: { KeyId: string };
  CreateParams: { Bytes: number };
  UpdateParams: undefined;
  ReadResult: {};
};

const randomKey = resource<RandomKeyApi>({
  type: "factory/keys/RandomKey",
  provider: "@notation/factory",
});

const randomKeySchema = randomKey.defineSchema({
  Bytes: {
    propertyType: "param",
    presence: "required",
    immutable: true,
    value: v.pipe(v.number(), v.integer(), v.minValue(16)),
  },
  KeyId: {
    propertyType: "computed",
    presence: "required",
    primaryKey: true,
    value: v.string(),
  },
  /** `Bytes` random bytes, in hex. */
  Value: { propertyType: "credential", value: v.string() },
} as const);

const generate = (bytes: number) => randomBytes(bytes).toString("hex");

/**
 * A random key, such as the hub's root key. Its value is the credential
 * `Value`, which is made in memory and never recorded. When a resource that
 * takes the value needs it and deploy holds none, deploy rotates the key, so
 * the key gets a new value and every resource that takes it is written again.
 */
export const RandomKey = randomKeySchema.defineOperations({
  create: async (params) => ({
    KeyId: randomUUID(),
    Value: generate(params.Bytes),
  }),
  rotate: {
    Value: async (_key, state) => generate(state.Bytes),
  },
  read: async (key) => key,
  delete: async () => {},
});

export type RandomKeyInstance = InstanceType<typeof RandomKey>;

type RecordedKeyApi = {
  Key: { KeyId: string };
  CreateParams: { Bytes: number };
  UpdateParams: undefined;
  ReadResult: {};
};

const recordedKey = resource<RecordedKeyApi>({
  type: "factory/keys/RecordedKey",
  provider: "@notation/factory",
});

const recordedKeySchema = recordedKey.defineSchema({
  Bytes: {
    propertyType: "param",
    presence: "required",
    immutable: true,
    value: v.pipe(v.number(), v.integer(), v.minValue(16)),
  },
  KeyId: {
    propertyType: "computed",
    presence: "required",
    primaryKey: true,
    value: v.string(),
  },
  /** `Bytes` random bytes, in hex. */
  Value: { propertyType: "computed", presence: "required", value: v.string() },
} as const);

/**
 * A random key whose value is a computed output, which state records, such
 * as the router's sync key. Unlike a `RandomKey`, any deploy can take its
 * value without rotating it.
 */
export const RecordedKey = recordedKeySchema.defineOperations({
  create: async (params) => ({
    KeyId: randomUUID(),
    Value: generate(params.Bytes),
  }),
  read: async (key) => key,
  delete: async () => {},
});
