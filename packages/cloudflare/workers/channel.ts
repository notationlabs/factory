import { WorkerEntrypoint } from "cloudflare:workers";
import type {
  ChannelContext,
  Delivery,
  FactoryStatus,
} from "@notation/factory/router";
import { channel } from "factory:channel";
import type { SecretsStoreSecret } from "./types.ts";

type Env = Record<string, unknown>;

// The secrets and values that the connection declared are bound under their
// own names.
const context = (env: Env): ChannelContext => ({
  secret: async (name) => {
    const binding = env[name] as SecretsStoreSecret | undefined;
    if (!binding) throw new Error(`no secret bound as ${name}`);
    return binding.get();
  },
  value: (name) => {
    const value = env[name];
    if (typeof value !== "string") throw new Error(`no value bound as ${name}`);
    return value;
  },
});

/** One connection's channel, which the router calls over its service binding. */
export default class ChannelWorker extends WorkerEntrypoint<Env> {
  // Cloudflare refuses a Worker whose default export has no event handler,
  // and RPC methods don't count as one.
  fetch() {
    return new Response("not found", { status: 404 });
  }

  receive(request: Request) {
    return channel(context(this.env)).receive(request);
  }

  match(selector: unknown, delivery: Delivery<unknown>) {
    return channel(context(this.env)).match(selector, delivery);
  }

  sync(url: string) {
    return channel(context(this.env)).sync(url);
  }

  read(repo: string, dir: string, ref?: string) {
    const { read } = channel(context(this.env));
    if (!read) throw new Error("This connection's channel can't read repos.");
    return read(repo, dir, ref);
  }

  writeStatus(repo: string, status: FactoryStatus) {
    const { writeStatus } = channel(context(this.env));
    if (!writeStatus) throw new Error("This connection's channel can't write a repo's status.");
    return writeStatus(repo, status);
  }
}
