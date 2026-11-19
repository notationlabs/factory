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
  /** The event as a trigger's worktree function reads it, such as GitHub's webhook payload. */
  payload: unknown;
};

/**
 * Where a delivery's run reads and replies. `id` names the conversation,
 * such as an issue. `thread` is the channel's own reference to it, which
 * only its `reply` reads.
 */
export type Conversation = {
  id: string;
  prompt: string;
  thread: unknown;
  /** What the conversation is, such as `GitHub issue`, for the runner's system prompt. */
  channel?: string;
  /** Text that the runner adds to its system prompt, such as which repo the conversation is in. */
  context?: string;
};

/** The trigger that a run is for: its selector, and the agent it runs. */
export type ConversationTrigger = { selector: unknown; agent: string };

/**
 * A repo whose outpost may need deploying again. `ref` is the commit to read
 * `.factory/` at, or the default branch's head if there's none. `removed`
 * means the hub can no longer read the repo.
 */
export type SourceChange = { repo: string; ref?: string; removed?: boolean };

export type Received<E> =
  | { status: "accepted"; delivery: Delivery<E> }
  /** The delivery changed what repos hold, or which repos the hub can read, such as a push or an install. */
  | { status: "source"; changes: SourceChange[] }
  | { status: "ignored"; reason: string }
  | { status: "rejected"; reason: string };

/** The files under a directory of a repo at one commit, by their path in the directory. */
export type SourceFiles = { ref: string; files: Record<string, string> };

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
  /** For a code host's channel: the files under `dir` in `repo` at `ref`, or at the default branch's head. */
  read?(repo: string, dir: string, ref?: string): Promise<SourceFiles>;
  /** For a code host's channel: shows the outpost's status on the repo, as `FACTORY_STATUS`. */
  writeStatus?(repo: string, status: FactoryStatus): Promise<void>;
  /** For a code host's channel: creates or updates the check named `check.name` on commit `ref`. */
  writeCheck?(repo: string, ref: string, check: BuildCheck): Promise<void>;
  /** The conversation that a run for the delivery belongs to. A channel without it can't start runs. */
  conversation?(delivery: Delivery<E>, trigger: ConversationTrigger): Conversation | Promise<Conversation>;
  /** Posts `text` to a conversation's thread. */
  reply?(thread: unknown, text: string): Promise<void>;
  /** For a code host's channel: a short-lived token for `repo`, with only `permissions`. */
  token?(repo: string, permissions: Record<string, "read" | "write">): Promise<string>;
}

/** The outcome of a repo's last deploy, as the repo shows it. */
export type FactoryStatus = {
  state: "deployed" | "failed";
  /** The commit that `.factory/` was read at, if it was read. */
  ref?: string;
  error?: string;
  /** When the deploy finished, as an ISO date. */
  at: string;
  /** The containers whose images started building. */
  building?: string[];
};

/** A container image's build, as a check on the commit it was built from. */
export type BuildCheck = {
  name: string;
  state: "queued" | "in_progress" | "success" | "failure" | "cancelled";
  /** The build's log. */
  url?: string;
  summary?: string;
};

/** What a channel module exports. */
export type ChannelModule = { channel(ctx: ChannelContext): Channel<any> };

/** A channel as the router calls it, where each call may cross to another process. */
export type RemoteChannel<E = unknown> = {
  [K in keyof Channel<E>]-?: (
    ...args: Parameters<NonNullable<Channel<E>[K]>>
  ) => Promise<Awaited<ReturnType<NonNullable<Channel<E>[K]>>>>;
};
