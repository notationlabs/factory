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
  /** The web page of the post that the delivery is about. A restarted run's sign-in sends the browser back there. */
  url?: string;
};

/**
 * Where a delivery's run reads and replies. `id` names the conversation,
 * such as an issue. `thread` is the channel's own reference to it, which
 * only its `messages` and `reply` read. It holds what `messages` needs,
 * such as the trigger's `from`.
 */
export type Conversation = {
  id: string;
  thread: unknown;
  /** The id of the thread's message that started the run, as `messages` names it. */
  message?: string;
  /**
   * What happened, for a run that an event without a message started, such
   * as `The issue was labelled \`ready\`.` The runner never skips such a run.
   */
  event?: string;
  /** What the conversation is, such as `GitHub issue`, for the runner's system prompt. */
  channel?: string;
  /** Text that the runner adds to its system prompt, such as which repo the conversation is in. */
  context?: string;
};

/**
 * One message in a conversation's thread, as the runner shows it to the
 * agent. `author` is how the platform names the author, such as `@alice`.
 * A reply from one of the hub's agents has `agent`, and another bot has
 * `bot`. Only a person has `role`, their role where the thread is, and
 * `canTrigger`, whether they match the trigger's `from`.
 */
export type ThreadMessage = {
  /** Unique in the thread. */
  id: string;
  author: string;
  body: string;
  agent?: string;
  bot?: boolean;
  role?: string;
  canTrigger?: boolean;
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
export type SourceFiles = {
  ref: string;
  files: Record<string, string>;
  /** The paths of the files that the repo marks executable. */
  executables?: string[];
};

/**
 * Whether a selector's `from` lets the delivery start a run. `check` holds
 * the author sets that need a call to the platform, which the router doesn't
 * make yet.
 */
export type AuthorCheck =
  | { result: "allowed" }
  | { result: "denied" }
  | { result: "check"; sets: unknown[] };

/** Who signed in: for GitHub, the user's login and numeric account id. */
export type Operator = { login: string; id: string };

interface ChannelBase<E> {
  /** Checks the delivery's signature and parses it. */
  receive(request: Request): Promise<Received<E>>;
  /**
   * Whether `selector` selects the delivery, and if so, whether its author
   * may start a run. `selectors` are those of all the outpost's triggers on
   * this connection, including `selector`.
   */
  match(selector: unknown, delivery: Delivery<E>, selectors?: unknown[]): AuthorCheck | undefined;
  /** Sets up the platform side of the connection, such as a webhook, to deliver to `url`. Throws if it fails. */
  sync(url: string): Promise<void>;
  /** For a code host's channel: the files under `dir` in `repo` at `ref`, or at the default branch's head. */
  read?(repo: string, dir: string, ref?: string): Promise<SourceFiles>;
  /** For a code host's channel: shows the outpost's status on the repo, as `FACTORY_STATUS`. */
  writeStatus?(repo: string, status: FactoryStatus): Promise<void>;
  /** For a code host's channel: creates or updates the check named `check.name` on commit `ref`. */
  writeCheck?(repo: string, ref: string, check: BuildCheck): Promise<void>;
  /**
   * Shows on the delivery's post that a run is starting for it, such as with
   * GitHub's 👀 reaction. `selectors` are those of the triggers that start
   * runs for it.
   */
  acknowledge?(delivery: Delivery<E>, selectors: unknown[]): Promise<void>;
  /**
   * Shows that the delivery's post has been answered, once a run's last
   * reply or failure notice is posted, such as by removing GitHub's 👀
   * reaction.
   */
  answered?(delivery: Delivery<E>): Promise<void>;
  /**
   * Posts `text` to a conversation's thread, or replaces the text of
   * `message`, a message that an earlier reply to the thread posted.
   * Resolves to the id of the message it posted or replaced.
   */
  reply?(thread: unknown, text: string, message?: string): Promise<string | undefined>;
  /** For a code host's channel: a short-lived token for `repo`, with only `permissions`. */
  token?(repo: string, permissions: Record<string, "read" | "write">): Promise<string>;
  /** For a code host's channel: every repo that the hub can read, as `owner/name`. */
  repos?(): Promise<string[]>;
  /**
   * For sign-in through the channel's platform: the page that signs a person
   * in, and then sends the browser to `redirect` with a code and `state`.
   * Without `redirect`, the browser goes to the CLI's callback, for operator
   * sign-in.
   */
  signInUrl?(state: string, redirect?: string): Promise<string>;
  /** For sign-in: exchanges the code that the callback at `redirect` got for the person's identity. */
  signIn?(code: string, redirect?: string): Promise<Operator>;
  /**
   * Whether `selector`'s `from` lets `person`, who signed in with `signIn`,
   * start a run for the delivery. The restart link of a lost run checks it.
   */
  canTrigger?(selector: unknown, delivery: Delivery<E>, person: Operator): Promise<boolean>;
}

/** A channel that starts runs has both `conversation` and `messages`. A channel without them can't start runs. */
type Conversations<E> =
  | {
      /** The conversation that a run for the delivery belongs to. */
      conversation(delivery: Delivery<E>, trigger: ConversationTrigger): Conversation | Promise<Conversation>;
      /** The messages in a conversation's thread, oldest first. */
      messages(thread: unknown): Promise<ThreadMessage[]>;
    }
  | { conversation?: never; messages?: never };

/**
 * One connection's deliveries, as the router handles them. A provider's
 * package implements it, and each platform decides where it runs.
 */
export type Channel<E = unknown> = ChannelBase<E> & Conversations<E>;

/** The outcome of a repo's last deploy, as the repo shows it. */
export type FactoryStatus = {
  state: "deployed" | "failed";
  /** The commit that `.factory/` was read at, if it was read. */
  ref?: string;
  error?: string;
  /** When the deploy finished, as an ISO date. */
  at: string;
  /** The containers whose images this deploy started building. Each build's progress is in its `factory/build <container>` check, not here. */
  builds?: string[];
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
