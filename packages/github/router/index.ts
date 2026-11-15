import {
  type AuthorCheck,
  type ChannelProvider,
  deriveKey,
  hmacHex,
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

/** The GitHub connections in the router's config, by App id. */
const connections = (config: Partial<RouterConfig>) =>
  Object.entries(config.connections ?? {}).flatMap(([key, entry]) =>
    entry.provider === "github"
      ? [{ name: key.slice("github/".length), appId: entry.source, entry }]
      : [],
  );

/** The parts of an issue or comment event that selectors read. */
export type GithubEvent = {
  action: string;
  /** The author of the comment, or of the issue. */
  author: { login: string; association: string };
  body: string;
  /** The body before an edit. The same as `body` when an edit didn't change it. */
  before: string;
  labels: string[];
};

type Post = {
  body?: string | null;
  user?: { login: string };
  author_association?: string;
};

const parse = (event: string, payload: any): GithubEvent | undefined => {
  const post: Post | undefined =
    event === "issue_comment"
      ? payload.comment
      : event === "issues"
        ? payload.issue
        : undefined;
  if (!post || typeof payload.action !== "string") return undefined;
  const body = post.body ?? "";
  return {
    action: payload.action,
    author: {
      login: post.user?.login ?? "",
      association: post.author_association ?? "",
    },
    body,
    before: payload.changes?.body?.from ?? body,
    labels: (payload.issue?.labels ?? []).map((l: { name: string }) => l.name),
  };
};

/** Author associations that mean the person has write access to the repo. */
const WRITE_ACCESS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether `body` mentions `mention` as GitHub would: case-insensitively, and
 * not as part of a longer name or an email address (`@claudette`,
 * `me@claude.ai`).
 */
export const mentions = (body: string, mention: string) =>
  new RegExp(`(?<![\\w@.-])${escapeRegExp(mention)}(?![\\w-])`, "i").test(body);

type Selector = {
  actions: string[];
  mention?: string;
  labels?: string[];
  from: AuthorSet | AuthorSet[];
};

const selects = (selector: Selector, event: GithubEvent) => {
  if (!selector.actions.includes(event.action)) return false;
  if (selector.labels?.some((l) => !event.labels.includes(l))) return false;
  if (selector.mention) {
    if (!mentions(event.body, selector.mention)) return false;
    // An edit matches only if it newly adds the mention.
    if (event.action === "edited" && mentions(event.before, selector.mention)) {
      return false;
    }
  }
  return true;
};

const checkAuthor = (
  from: Selector["from"],
  { author }: GithubEvent,
): AuthorCheck => {
  const sets = Array.isArray(from) ? from : [from];
  const allowed = sets.some((s) =>
    s.kind === "user"
      ? s.login.toLowerCase() === author.login.toLowerCase()
      : s.kind === "collaborators" && WRITE_ACCESS.has(author.association),
  );
  if (allowed) return { result: "allowed" };
  const teams = sets.filter((s) => s.kind === "team");
  return teams.length ? { result: "check", sets: teams } : { result: "denied" };
};

/** GitHub Apps' webhooks. A delivery's scope is its repo. */
export const channel: ChannelProvider<GithubEvent> = {
  provider: "github",

  receives: (request) => request.headers.has("x-github-event"),

  async receive(request, ctx) {
    const appId = request.headers.get("x-github-hook-installation-target-id");
    const connection = connections(ctx.config).find((c) => c.appId === appId);
    if (!connection) {
      return { status: "rejected", reason: `no connection for App ${appId}` };
    }

    const body = new Uint8Array(await request.arrayBuffer());
    const secret = await webhookSecret(await ctx.rootKey(), connection.appId);
    const signature = request.headers.get("x-hub-signature-256");
    if (!(await verifySignature(secret, body, signature))) {
      return { status: "rejected", reason: "bad signature" };
    }

    const event = request.headers.get("x-github-event")!;
    const payload = JSON.parse(new TextDecoder().decode(body));
    const repo: string | undefined = payload.repository?.full_name;
    const data = parse(event, payload);
    if (!repo || !data) return { status: "ignored", reason: event };
    return {
      status: "accepted",
      delivery: {
        id: request.headers.get("x-github-delivery") ?? "",
        connection: connection.name,
        scope: repo,
        repo,
        event,
        data,
      },
    };
  },

  match(selector, delivery) {
    const s = selector as Selector;
    return selects(s, delivery.data)
      ? checkAuthor(s.from, delivery.data)
      : undefined;
  },

  async sync(ctx) {
    const results: Record<string, string> = {};
    for (const { name, appId, entry } of connections(ctx.config)) {
      try {
        await setWebhookConfig({
          appId,
          privateKey: await ctx.secret(entry.credentials.privateKey!),
          rootKey: await ctx.rootKey(),
          url: ctx.url,
        });
        results[`github/${name}`] = "ok";
      } catch (error) {
        results[`github/${name}`] =
          error instanceof Error ? error.message : String(error);
      }
    }
    return results;
  },
};

const GITHUB_API = "https://api.github.com";

/**
 * Sets the App's webhook to `url`, with the webhook secret derived from the
 * root key. It authenticates as the App with its private key.
 */
const setWebhookConfig = async ({
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
