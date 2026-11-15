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

type Payload = {
  action?: string;
  repository?: { full_name: string };
  issue?: { body: string | null; labels?: { name: string }[] };
  comment?: { body: string };
  changes?: { body?: { from?: string } };
  sender?: { login: string };
};

type Match = {
  actions: string[];
  mention?: string;
  labels?: string[];
  from: AuthorSet | AuthorSet[];
};

/**
 * Whether the sender is in the trigger's `from`. `allowed` and `denied` are
 * decided from the payload. `check` lists the author sets that need a call to
 * GitHub (collaborators and teams), which the router doesn't make yet.
 */
export type AuthorCheck =
  | { result: "allowed" }
  | { result: "denied" }
  | { result: "check"; sets: AuthorSet[] };

export type TriggerMatch = { trigger: string; author: AuthorCheck };

const mentions = (body: string | null | undefined, mention: string) =>
  body?.toLowerCase().includes(mention.toLowerCase()) ?? false;

/** The text that a `mention` is looked for in, and its text before an edit. */
const texts = (event: string, payload: Payload) =>
  event === "issue_comment"
    ? { body: payload.comment?.body, before: payload.changes?.body?.from }
    : { body: payload.issue?.body, before: payload.changes?.body?.from };

const selects = (event: string, match: Match, payload: Payload) => {
  if (!payload.action || !match.actions.includes(payload.action)) return false;
  if (match.labels?.length) {
    const names = new Set(payload.issue?.labels?.map((l) => l.name));
    if (!match.labels.some((l) => names.has(l))) return false;
  }
  if (match.mention) {
    const { body, before } = texts(event, payload);
    if (!mentions(body, match.mention)) return false;
    // An edit matches only if it newly adds the mention.
    if (payload.action === "edited" && mentions(before, match.mention)) {
      return false;
    }
  }
  return true;
};

const checkAuthor = (from: Match["from"], login: string | undefined): AuthorCheck => {
  const sets = Array.isArray(from) ? from : [from];
  if (
    login &&
    sets.some((s) => s.kind === "user" && s.login.toLowerCase() === login.toLowerCase())
  ) {
    return { result: "allowed" };
  }
  const remote = sets.filter((s) => s.kind !== "user");
  return remote.length ? { result: "check", sets: remote } : { result: "denied" };
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
    matches.push({ trigger: id, author: checkAuthor(match.from, payload.sender?.login) });
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
