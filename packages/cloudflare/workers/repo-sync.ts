import { DurableObject } from "cloudflare:workers";
import { redeployRepo, type SourceChange } from "@notation/factory/router";
import { routerStore, type RouterEnv } from "./router-store.ts";

const QUEUE = "queue";

/**
 * Deploys the repos of a sync one at a time, one repo for each alarm, so no
 * request's time limit cuts the deploys off. The router hosts one object.
 */
export class RepoSync extends DurableObject<RouterEnv> {
  /** Replaces the changes that are left with `changes`, and sets the alarm to deploy them. */
  async start(changes: SourceChange[]) {
    await this.ctx.storage.put(QUEUE, changes);
    await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm() {
    const [change] = ((await this.ctx.storage.get(QUEUE)) ?? []) as SourceChange[];
    if (!change) return;
    await redeployRepo(change, await routerStore(this.env));
    // A sync that started during the deploy replaced the queue. Its first
    // change is dropped only if it's the change just deployed.
    const queue = ((await this.ctx.storage.get(QUEUE)) ?? []) as SourceChange[];
    const rest = isSame(queue[0], change) ? queue.slice(1) : queue;
    await this.ctx.storage.put(QUEUE, rest);
    if (rest.length) await this.ctx.storage.setAlarm(Date.now());
  }
}

const isSame = (a: SourceChange | undefined, b: SourceChange) =>
  a?.repo === b.repo && Boolean(a.removed) === Boolean(b.removed) && a.ref === b.ref;
