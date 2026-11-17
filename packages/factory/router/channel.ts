/**
 * What a platform gives a channel: the secrets and values that the
 * connection declared for it, by name.
 */
export type ChannelContext = {
  secret(name: string): Promise<string>;
  value(name: string): string;
};

/**
 * A verified delivery, in the terms the router routes by. `data` is the
 * provider's own view of the event, which only its `match` reads.
 */
export type Delivery<E> = {
  id: string;
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
 * One connection's deliveries, as the router handles them. A provider's
 * package implements it, and each platform decides where it runs.
 */
export interface Channel<E = unknown> {
  /** Checks the delivery's signature and parses it. */
  receive(request: Request): Promise<Received<E>>;
  /** Whether `selector` selects the delivery, and if so, whether its author may start a run. */
  match(selector: unknown, delivery: Delivery<E>): AuthorCheck | undefined;
  /** Sets up the platform side of the connection, such as a webhook, to deliver to `url`. Throws if it fails. */
  sync(url: string): Promise<void>;
}

/** What a channel module exports. */
export type ChannelModule = { channel(ctx: ChannelContext): Channel<any> };

/** A channel as the router calls it, where each call may cross to another process. */
export type RemoteChannel<E = unknown> = {
  [K in keyof Channel<E>]: (
    ...args: Parameters<Channel<E>[K]>
  ) => Promise<Awaited<ReturnType<Channel<E>[K]>>>;
};
