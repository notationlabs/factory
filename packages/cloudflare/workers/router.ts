import { handle } from "@notation/factory/router";
import { type RouterEnv, routerStore } from "./router-store.ts";

type Context = { waitUntil(task: Promise<unknown>): void };

export default {
  async fetch(request: Request, env: RouterEnv, ctx: Context) {
    return handle(request, await routerStore(env, (task) => ctx.waitUntil(task)));
  },
};

export { DeliveryInbox } from "./inbox.ts";
