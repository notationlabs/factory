import type { AgentEntry, ContainerEntry } from "../contracts/outpost.ts";
import type { ThreadMessage } from "./channel.ts";
import { deriveKey, hmacHex, timingSafeEqual } from "./keys.ts";

/**
 * Where a run's reply goes: the connection whose channel posts it, and the
 * channel's thread. `delivery` and `run` name the run's dispatch in the
 * inbox, for its heartbeats. `expires` is in ms since the epoch.
 */
export type ReplyTicket = { connection: string; thread: unknown; delivery?: string; run?: string; expires: number };

/**
 * A message that a run's reply posted, which a later reply of the run
 * replaces. The router signs its id together with the reply ticket's
 * signature, so a run can only replace its own messages.
 */
export type ReplyMessage = { id: string; signature: string };

/** What the runner posts to a run's `reply.url`. With `message`, the reply replaces that message. */
export type Relay = { ticket: ReplyTicket; signature: string; text: string; message?: ReplyMessage };

/** What the router answers to a `Relay`: the message that the reply posted or replaced, if the channel names it. */
export type RelayResult = { ok: true; message?: ReplyMessage };

/**
 * What the runner posts to a run's `reply.heartbeat` once a minute while it
 * holds the run, queued or running.
 * `message` is the message that the run's replies replace now. `done` says
 * that the run finished, so the router stops watching it.
 */
export type Heartbeat = { ticket: ReplyTicket; signature: string; message?: ReplyMessage; done?: boolean };

/** What the router answers to a `Heartbeat`. `lost` means that the router has marked the run lost, and posted a notice in place of its message. */
export type HeartbeatResult = { ok: true; lost?: boolean };

/** How long the router waits for a run's next heartbeat before it marks the run lost. */
export const LOST_AFTER_MS = 5 * 60 * 1000;

/** What the runner posts to the router's `/messages` route, next to `reply.url`. The router answers with `MessagesResult`. */
export type MessagesRequest = { ticket: ReplyTicket; signature: string };

/** The messages in a run's thread, oldest first. */
export type MessagesResult = { messages: ThreadMessage[] };

/** Which container's policy tokens the router mints again: a container of the repo's outpost. `expires` is in ms since the epoch. */
export type TokenTicket = { repo: string; container: string; expires: number };

/** What the runner posts to a run's `refresh.url`. The router answers with `Tokens`. */
export type TokenRequest = { ticket: TokenTicket; signature: string };

/** A token for each of a container's code host policies. */
export type Tokens = { policy: string; repo: string; token: string }[];

/** A container image's build, as the deployer reports it. `ref` is the code host's commit that the build's source was read at. `expires` is in ms since the epoch. */
export type BuildReport = {
  repo: string;
  ref: string;
  container: string;
  state: "in_progress" | "success" | "failure" | "cancelled";
  url?: string;
  summary?: string;
  expires: number;
};

/** What the deployer posts to the router's `/builds` route. */
export type BuildReportRequest = { report: BuildReport; signature: string };

/** What a container's runner needs for one trigger match. */
export type Run = {
  id: string;
  repo: string;
  trigger: string;
  container: string;
  /** The container's runtimes. The provider gives the container their accounts' credentials. */
  runtimes: string[];
  /** The container's startup files, read from `.factory/` in the checkout. */
  files: ContainerEntry["files"];
  agent: { id: string } & AgentEntry;
  /**
   * The conversation. `message` is the id of the thread's message that
   * started the run, and `event` says what happened when no message did.
   */
  conversation: { id: string; message?: string; event?: string; channel?: string; context?: string };
  /** The branch to run on, cut from `base` if it doesn't exist. Without it, the run gets a scratch checkout of the default branch. */
  worktree?: { branch: string; base?: string };
  /** A read-only token for cloning the repo. */
  cloneToken: string;
  /** A token for each of the container's code host policies. */
  tokens: Tokens;
  /** The runner posts a `TokenRequest` with this ticket and signature to `url` for new tokens, before the old ones expire. */
  refresh: { url: string; ticket: TokenTicket; signature: string };
  /**
   * The runner posts a `Relay` with this ticket and signature to `url`.
   * `message` is a message that the router posted while the run waited for
   * its container, which the run's first reply replaces. The runner posts a
   * `Heartbeat` with the same ticket to `heartbeat`, if it's set.
   */
  reply: { url: string; ticket: ReplyTicket; signature: string; message?: ReplyMessage; heartbeat?: string };
};

/**
 * Whether the container's outpost Worker queued the run, or can't take it
 * yet because the container's first image build hasn't finished. The
 * deployer throws any other failure.
 */
export type RunResult = "queued" | "building";

/** How long a container may reply to a run, or ask for its tokens again. A run may wait in the queue behind others before it starts. */
export const REPLY_TTL_MS = 24 * 60 * 60 * 1000;

const sign = async (rootKey: string, purpose: string, ticket: { expires: number }) =>
  hmacHex(await deriveKey(rootKey, purpose), JSON.stringify(ticket));

const verify = async (rootKey: string, purpose: string, ticket: { expires: number }, signature: string) =>
  ticket.expires > Date.now() && timingSafeEqual(signature, await sign(rootKey, purpose, ticket));

export const signTicket = (rootKey: string, ticket: ReplyTicket) => sign(rootKey, "router:relay", ticket);

/** Whether the router signed `ticket`, and it hasn't expired. */
export const verifyTicket = (rootKey: string, ticket: ReplyTicket, signature: string) =>
  verify(rootKey, "router:relay", ticket, signature);

/** Signs the id of a message that the reply with the ticket signature `ticket` posted. */
export const signMessage = async (rootKey: string, ticket: string, id: string) =>
  hmacHex(await deriveKey(rootKey, "router:message"), JSON.stringify([ticket, id]));

/** Whether the router signed `message` for replies with the ticket signature `ticket`. */
export const verifyMessage = async (rootKey: string, ticket: string, message: ReplyMessage) =>
  timingSafeEqual(message.signature, await signMessage(rootKey, ticket, message.id));

export const signTokenTicket = (rootKey: string, ticket: TokenTicket) => sign(rootKey, "router:tokens", ticket);

/** Whether the router signed `ticket`, and it hasn't expired. */
export const verifyTokenTicket = (rootKey: string, ticket: TokenTicket, signature: string) =>
  verify(rootKey, "router:tokens", ticket, signature);

export const signBuildReport = (rootKey: string, report: BuildReport) => sign(rootKey, "router:builds", report);

/** Whether the deployer signed `report`, and it hasn't expired. */
export const verifyBuildReport = (rootKey: string, report: BuildReport, signature: string) =>
  verify(rootKey, "router:builds", report, signature);

/** A lost run that a restart link starts again: the run `run` of the delivery `delivery` of `connection`. `expires` is in ms since the epoch. */
export type RestartTicket = { connection: string; delivery: string; run: string; expires: number };

const base64url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const fromBase64url = (text: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0)));

/** A restart link's token: the ticket as base64url JSON, a dot, and its signature. */
export const signRestart = async (rootKey: string, ticket: RestartTicket) =>
  `${base64url(JSON.stringify(ticket))}.${await sign(rootKey, "router:restart", ticket)}`;

/** The ticket in a restart link's token, if the router signed it and it hasn't expired. */
export const verifyRestart = async (rootKey: string, token: string): Promise<RestartTicket | undefined> => {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return undefined;
  let parsed: Partial<RestartTicket>;
  try {
    parsed = JSON.parse(fromBase64url(token.slice(0, dot)));
  } catch {
    return undefined;
  }
  const { connection, delivery, run, expires } = parsed ?? {};
  if (typeof connection !== "string" || typeof delivery !== "string" || typeof run !== "string" || typeof expires !== "number") {
    return undefined;
  }
  // The signature covers the ticket's JSON with its keys in this order.
  const ticket = { connection, delivery, run, expires };
  return (await verify(rootKey, "router:restart", ticket, token.slice(dot + 1))) ? ticket : undefined;
};

/** A git branch name the runner can check out: no `..`, no leading `-` or `/`, and only letters, digits and `._/-`. */
export const isBranchName = (name: string) =>
  /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/.test(name) &&
  !name.includes("..") &&
  !name.includes("//") &&
  !name.endsWith("/") &&
  !name.endsWith(".lock") &&
  name.length <= 200;
