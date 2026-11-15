import type { RouterConfig } from "../contracts/router.ts";

/** What the router gives a channel provider: its config, and the secrets bound to it. */
export type RouterContext = {
  config: Partial<RouterConfig>;
  /** The value of the secret bound to the router as `name`. */
  secret(name: string): Promise<string>;
  rootKey(): Promise<string>;
};

/**
 * A verified delivery, in the terms the router routes by. `data` is the
 * provider's own view of the event, which only its `match` reads.
 */
export type Delivery<E> = {
  id: string;
  connection: string;
  /** What a channel's `scope` is compared with, such as `owner/repo` for GitHub. */
  scope: string;
  /** The repo whose outpost the delivery may be for. */
  repo: string;
  event: string;
  data: E;
};

export type Received<E> =
  | { status: "accepted"; delivery: Delivery<E> }
  | { status: "ignored"; reason: string }
  | { status: "rejected"; reason: string };

/**
 * Whether a selector's `from` lets the delivery start a run. `check` holds
 * the author sets that need a call to the platform, which the router doesn't
 * make yet.
 */
export type AuthorCheck =
  | { result: "allowed" }
  | { result: "denied" }
  | { result: "check"; sets: unknown[] };

/**
 * A platform's deliveries, as the router handles them. The router knows only
 * this contract: each provider's package implements it.
 */
export interface ChannelProvider<E = unknown> {
  readonly provider: string;
  /** Whether a request to `/webhook` is this platform's. */
  receives(request: Request): boolean;
  /** Finds the delivery's connection, checks its signature and parses it. */
  receive(request: Request, ctx: RouterContext): Promise<Received<E>>;
  /** Whether `selector` selects the delivery, and if so, whether its author may start a run. */
  match(selector: unknown, delivery: Delivery<E>): AuthorCheck | undefined;
  /** Sets up the platform side of each of the provider's connections, such as a webhook. */
  sync?(ctx: RouterContext & { url: string }): Promise<Record<string, string>>;
}
