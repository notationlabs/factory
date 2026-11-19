import assert from "node:assert/strict";
import { test } from "node:test";
import { type RouterEnv, routerStore } from "./router-store.ts";
import type { KVNamespace } from "./types.ts";

const memoryKv = (): KVNamespace & { keys(): string[] } => {
  const values = new Map<string, string>();
  return {
    keys: () => [...values.keys()].sort(),
    get: (async (key: string, type?: "json") => {
      const value = values.get(key);
      if (value === undefined) return null;
      return type === "json" ? JSON.parse(value) : value;
    }) as KVNamespace["get"],
    put: async (key, value) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
    list: async ({ prefix }) => ({ keys: [...values.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
};

const deploys = async (kv: KVNamespace) => (await routerStore({ FACTORY_KV: kv } as unknown as RouterEnv)).deploys!;

test("the deploy log keeps each build under its own key, and lists them with their repo's deploy", async () => {
  const kv = memoryKv();
  const log = await deploys(kv);
  await log.put("Acme/API", { state: "deployed", ref: "abc", at: "now" });
  await log.putBuild("Acme/API", "dev", { state: "queued", ref: "abc", at: "now" });
  await log.putBuild("acme/api", "ci", { state: "success", ref: "old", at: "then" });
  await log.put("acme/web", { state: "failed", at: "now" });
  assert.deepEqual(kv.keys(), ["builds/acme/api/ci", "builds/acme/api/dev", "deploys/acme/api", "deploys/acme/web"]);
  assert.deepEqual((await log.build("acme/api", "dev"))?.state, "queued");
  assert.deepEqual(await log.list(), [
    {
      repo: "Acme/API",
      status: { state: "deployed", ref: "abc", at: "now" },
      builds: { ci: { state: "success", ref: "old", at: "then" }, dev: { state: "queued", ref: "abc", at: "now" } },
    },
    { repo: "acme/web", status: { state: "failed", at: "now" }, builds: {} },
  ]);

  assert.deepEqual(await log.repos(), ["acme/api", "acme/web"]);

  await log.pruneBuilds("Acme/API", ["dev"]);
  assert.deepEqual(kv.keys(), ["builds/acme/api/dev", "deploys/acme/api", "deploys/acme/web"]);

  await log.remove("acme/api");
  assert.deepEqual(kv.keys(), ["deploys/acme/web"]);
});
