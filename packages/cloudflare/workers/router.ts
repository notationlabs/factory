import { WorkerEntrypoint } from "cloudflare:workers";
import { handle } from "@notation/factory/router";
import { type RouterEnv, routerStore } from "./router-store.ts";
import { forwardToService } from "./services.ts";

type Context = { waitUntil(task: Promise<unknown>): void };

export default {
  async fetch(request: Request, env: RouterEnv, ctx: Context) {
    return handle(request, await routerStore(env, (task) => ctx.waitUntil(task)));
  },
};

/**
 * Takes outpost Workers' requests to the hub's services, over their service
 * bindings, and forwards each to the router's binding of its service. Only a
 * binding reaches it, so it trusts the sender headers that the outpost set.
 */
export class ServiceGateway extends WorkerEntrypoint<RouterEnv> {
  async fetch(request: Request) {
    return forwardToService(request, (binding) => this.env[binding]);
  }
}

export { DeliveryInbox } from "./inbox.ts";
export { RepoSync } from "./repo-sync.ts";
