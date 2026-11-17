import type { AgentEntry, ContainerEntry } from "../contracts/outpost.ts";
import { deriveKey, hmacHex, timingSafeEqual } from "./keys.ts";

/** Where a run's reply goes: the connection whose channel posts it, and the channel's thread. `expires` is in ms since the epoch. */
export type ReplyTicket = { connection: string; thread: unknown; expires: number };

/** What the runner posts to a run's `reply.url`. */
export type Relay = { ticket: ReplyTicket; signature: string; text: string };

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
  conversation: { id: string; prompt: string };
  /** The branch to run on, cut from `base` if it doesn't exist. Without it, the run gets a scratch checkout of the default branch. */
  worktree?: { branch: string; base?: string };
  /** A read-only token for cloning the repo. */
  cloneToken: string;
  /** A token for each of the container's code host policies. */
  tokens: { policy: string; repo: string; token: string }[];
  /** The runner posts a `Relay` with this ticket and signature to `url`. */
  reply: { url: string; ticket: ReplyTicket; signature: string };
};

/** How long a container may reply to a run. */
export const REPLY_TTL_MS = 24 * 60 * 60 * 1000;

const relayKey = (rootKey: string) => deriveKey(rootKey, "router:relay");

export const signTicket = async (rootKey: string, ticket: ReplyTicket) =>
  hmacHex(await relayKey(rootKey), JSON.stringify(ticket));

/** Whether the router signed `ticket`, and it hasn't expired. */
export const verifyTicket = async (rootKey: string, ticket: ReplyTicket, signature: string) =>
  ticket.expires > Date.now() && timingSafeEqual(signature, await signTicket(rootKey, ticket));

/** A git branch name the runner can check out: no `..`, no leading `-` or `/`, and only letters, digits and `._/-`. */
export const isBranchName = (name: string) =>
  /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/.test(name) &&
  !name.includes("..") &&
  !name.includes("//") &&
  !name.endsWith("/") &&
  !name.endsWith(".lock") &&
  name.length <= 200;
