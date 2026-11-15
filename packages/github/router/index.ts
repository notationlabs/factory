import {
  type ChannelEntry,
  deriveKey,
  hmacHex,
  type OutpostConfig,
  type RouterConfig,
  timingSafeEqual,
} from "@notation/factory/router";
import type { AuthorSet } from "../implementations/selectors.ts";
import { appJwt } from "./app-jwt.ts";

/** The webhook secret of the App with id `appId`, which the router derives from the root key. */
export const webhookSecret = (rootKey: string, appId: string) =>
  deriveKey(rootKey, `github:webhook:${appId}`);

/** Checks GitHub's `X-Hub-Signature-256` header against the raw request body. */
export const verifySignature = async (
  secret: string,
  body: Uint8Array<ArrayBuffer>,
  header: string | null,
) => {
  if (!header?.startsWith("sha256=")) return false;
  return timingSafeEqual(header.slice(7), await hmacHex(secret, body));
};

/** The name of the GitHub connection whose App has id `appId`. */
export const connectionForApp = (config: RouterConfig, appId: string) => {
  for (const [key, entry] of Object.entries(config.connections ?? {})) {
    if (entry.provider === "github" && entry.source === appId) {
      return key.slice("github/".length);
    }
  }
  return undefined;
};

type User = { login: string; type?: string };

type Post = { body: string | null; user?: User; author_association?: string };

type Payload = {
  action?: string;
  repository?: { full_name: string };
  issue?: Post & { labels?: { name: string }[] };
  comment?: Post;
  changes?: { body?: { from?: string } };
  sender?: User;
};

type Match = {
  actions: string[];
  mention?: string;
  labels?: string[];
  from: AuthorSet | AuthorSet[];
};

/**
 * Whether the people behind a delivery are in the trigger's `from`.
 * `allowed` and `denied` are decided from the payload. `check` lists the
 * teams that need a call to GitHub, which the router doesn't make yet.
 */
export type AuthorCheck =
  | { result: "allowed" }
  | { result: "denied" }
  | { result: "check"; sets: AuthorSet[] };

export type TriggerMatch = { trigger: string; author: AuthorCheck };

/** Author associations that mean the person has write access to the repo. */
const WRITE_ACCESS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether `body` mentions `mention` as GitHub would: case-insensitively, and
 * not as part of a longer name or an email address (`@claudette`,
 * `me@claude.ai`).
 */
export const mentions = (body: string | null | undefined, mention: string) =>
  body != null &&
  new RegExp(`(?<![\\w@.-])${escapeRegExp(mention)}(?![\\w-])`, "i").test(body);

/** The post a delivery is about: the comment, or else the issue. */
const postOf = (event: string, payload: Payload) =>
  event === "issue_comment" ? payload.comment : payload.issue;

const selects = (event: string, match: Match, payload: Payload) => {
  if (!payload.action || !match.actions.includes(payload.action)) return false;
  if (match.labels?.length) {
    const names = new Set(payload.issue?.labels?.map((l) => l.name));
    if (!match.labels.every((l) => names.has(l))) return false;
  }
  if (match.mention) {
    const body = postOf(event, payload)?.body;
    if (!mentions(body, match.mention)) return false;
    // An edit matches only if it newly adds the mention. An edit that didn't
    // touch the body, such as a title change, has no `changes.body`, so the
    // text before is the text now.
    const before = payload.changes?.body?.from ?? body;
    if (payload.action === "edited" && mentions(before, match.mention)) {
      return false;
    }
  }
  return true;
};

/** Whether one person is in `sets`. Collaborators are decided from the post's author association. */
const checkPerson = (sets: AuthorSet[], post: Post): AuthorCheck => {
  const login = post.user?.login.toLowerCase();
  for (const set of sets) {
    if (set.kind === "user" && set.login.toLowerCase() === login) {
      return { result: "allowed" };
    }
    if (
      set.kind === "collaborators" &&
      WRITE_ACCESS.has(post.author_association ?? "")
    ) {
      return { result: "allowed" };
    }
  }
  const teams = sets.filter((s) => s.kind === "team");
  return teams.length ? { result: "check", sets: teams } : { result: "denied" };
};

/**
 * Checks the post's author against `from`. On a comment, the issue's author
 * has to be in `from` too, so a comment from a trusted person doesn't make
 * the agent act on an issue a stranger wrote. Bots are always denied, so the
 * App's own comments can't start runs.
 */
const checkAuthors = (
  from: Match["from"],
  event: string,
  payload: Payload,
): AuthorCheck => {
  const sets = Array.isArray(from) ? from : [from];
  const posts = [postOf(event, payload), event === "issue_comment" ? payload.issue : undefined]
    .filter((p): p is Post => p !== undefined);
  if (!posts.length) return { result: "denied" };
  if (payload.sender?.type === "Bot" || posts.some((p) => p.user?.type === "Bot")) {
    return { result: "denied" };
  }
  const checks = posts.map((p) => checkPerson(sets, p));
  if (checks.some((c) => c.result === "denied")) return { result: "denied" };
  const pending = checks.flatMap((c) => (c.result === "check" ? c.sets : []));
  return pending.length
    ? { result: "check", sets: [...new Set(pending)] }
    : { result: "allowed" };
};

/** A channel without a scope covers the outpost's repo. */
const inChannel = (
  channel: ChannelEntry | undefined,
  { connection, outpostRepo, deliveryRepo }: {
    connection: string;
    outpostRepo: string;
    deliveryRepo: string;
  },
) =>
  channel?.provider === "github" &&
  channel.connection === connection &&
  (channel.scope ?? outpostRepo).toLowerCase() === deliveryRepo.toLowerCase();

/** The triggers of `outpost` that a delivery of `event` on `connection` selects. `repo` is the outpost's repo. */
export const matchTriggers = (
  outpost: OutpostConfig,
  { connection, repo, event, payload }: {
    connection: string;
    repo: string;
    event: string;
    payload: Payload;
  },
): TriggerMatch[] => {
  const matches: TriggerMatch[] = [];
  const deliveryRepo = payload.repository?.full_name;
  if (!deliveryRepo) return matches;
  for (const [id, trigger] of Object.entries(outpost.triggers ?? {})) {
    if (trigger.event !== event) continue;
    const channel = outpost.channels?.[trigger.channel];
    if (!inChannel(channel, { connection, outpostRepo: repo, deliveryRepo })) {
      continue;
    }
    const match = trigger.match as Match;
    if (!selects(event, match, payload)) continue;
    matches.push({ trigger: id, author: checkAuthors(match.from, event, payload) });
  }
  return matches;
};

const GITHUB_API = "https://api.github.com";

/**
 * Sets the App's webhook to `url`, with the webhook secret derived from the
 * root key. It authenticates as the App with its private key.
 */
export const setWebhookConfig = async ({
  appId,
  privateKey,
  rootKey,
  url,
}: {
  appId: string;
  privateKey: string;
  rootKey: string;
  url: string;
}) => {
  const response = await fetch(`${GITHUB_API}/app/hook/config`, {
    method: "PATCH",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${await appJwt(appId, privateKey)}`,
      "Content-Type": "application/json",
      "User-Agent": "notation-factory-router",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      url,
      content_type: "json",
      insecure_ssl: "0",
      secret: await webhookSecret(rootKey, appId),
    }),
  });
  if (!response.ok) {
    throw new Error(
      `GitHub PATCH /app/hook/config for App ${appId} failed with status ${response.status}: ${await response.text()}`,
    );
  }
};
