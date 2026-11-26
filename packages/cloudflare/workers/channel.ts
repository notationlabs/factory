import { WorkerEntrypoint } from "cloudflare:workers";
import type {
  BuildCheck,
  ChannelContext,
  ConversationTrigger,
  Delivery,
  FactoryStatus,
  Operator,
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

  writeCheck(repo: string, ref: string, check: BuildCheck) {
    const { writeCheck } = channel(context(this.env));
    if (!writeCheck) throw new Error("This connection's channel can't write checks.");
    return writeCheck(repo, ref, check);
  }

  conversation(delivery: Delivery<unknown>, trigger: ConversationTrigger) {
    const { conversation } = channel(context(this.env));
    if (!conversation) throw new Error("This connection's channel can't start runs.");
    return conversation(delivery, trigger);
  }

  messages(thread: unknown) {
    const { messages } = channel(context(this.env));
    if (!messages) throw new Error("This connection's channel can't read threads.");
    return messages(thread);
  }

  async acknowledge(delivery: Delivery<unknown>, selectors: unknown[]) {
    await channel(context(this.env)).acknowledge?.(delivery, selectors);
  }

  async unacknowledge(delivery: Delivery<unknown>) {
    await channel(context(this.env)).unacknowledge?.(delivery);
  }

  reply(thread: unknown, text: string, message?: string) {
    const { reply } = channel(context(this.env));
    if (!reply) throw new Error("This connection's channel can't reply.");
    return reply(thread, text, message);
  }

  token(repo: string, permissions: Record<string, "read" | "write">) {
    const { token } = channel(context(this.env));
    if (!token) throw new Error("This connection's channel can't mint tokens.");
    return token(repo, permissions);
  }

  repos() {
    const { repos } = channel(context(this.env));
    if (!repos) throw new Error("This connection's channel can't list repos.");
    return repos();
  }

  signInUrl(state: string, redirect?: string) {
    const { signInUrl } = channel(context(this.env));
    if (!signInUrl) throw new Error("This connection's channel can't sign people in.");
    return signInUrl(state, redirect);
  }

  signIn(code: string, redirect?: string) {
    const { signIn } = channel(context(this.env));
    if (!signIn) throw new Error("This connection's channel can't sign people in.");
    return signIn(code, redirect);
  }

  canTrigger(selector: unknown, delivery: Delivery<unknown>, person: Operator) {
    const { canTrigger } = channel(context(this.env));
    if (!canTrigger) throw new Error("This connection's channel can't check who may trigger an agent.");
    return canTrigger(selector, delivery, person);
  }
}
