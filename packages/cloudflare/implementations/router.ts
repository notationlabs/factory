import { defineGroup } from "@lightbox/notation-group";
import type { Router as RouterContract } from "lightbox";
import * as v from "valibot";
import { KvNamespace } from "../resources/kv.ts";
import { RouterConfig } from "../resources/router-config.ts";
import { Worker } from "../resources/worker.ts";

/** `new cloudflare.Router(...)`: a Worker, and the KV entry its config is contributed to. */
export const Router = defineGroup<RouterContract>({ type: "cloudflare/Router" })
  .defineSchema(v.object({ name: v.string() }))
  .defineImplementation(({ id, config, group }) => {
    const kv = group.add(
      new KvNamespace({
        id: `${id}-kv`,
        config: { title: `${config.name}-config` },
      }),
    );
    return {
      api: group.add(
        new Worker({
          id: `${id}-worker`,
          config: { ScriptName: config.name },
          dependencies: { kv },
        }),
      ),
      store: group.add(
        new RouterConfig({
          id: `${id}-config`,
          config: { key: "config" },
          dependencies: { kv },
        }),
      ),
    };
  });

export type RouterOptions = ConstructorParameters<typeof Router>[0];
