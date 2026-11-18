import {
  type AuthorCheck,
  type Channel,
  type ChannelContext,
  deriveKey,
  hmacHex,
  timingSafeEqual,
} from "@notation/factory/router";
import type { AuthorSet } from "../implementations/selectors.ts";
import { appJwt } from "./app-jwt.ts";
import { comment, readDir, repoToken, sourceChanges, writeCheck as writeRepoCheck, writeStatus as writeRepoStatus } from "./repos.ts";

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

/** The names of what a GitHub channel reads from its context. */
export const CHANNEL_SECRETS = { rootKey: "ROOT_KEY", privateKey: "PRIVATE_KEY" } as const;
export const CHANNEL_VALUES = { appId: "APP_ID" } as const;

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

/** The parts of an issue or comment payload that worktree functions and prompts read. */
const eventPayload = (payload: any) => ({
  action: payload.action,
  issue: payload.issue && {
    number: payload.issue.number,
    title: payload.issue.title,
    body: payload.issue.body,
    labels: (payload.issue.labels ?? []).map((l: { name: string }) => ({ name: l.name })),
    user: { login: payload.issue.user?.login },
    ...(payload.issue.pull_request && { pull_request: { url: payload.issue.pull_request.url } }),
  },
  ...(payload.comment && {
    comment: { id: payload.comment.id, body: payload.comment.body, user: { login: payload.comment.user?.login } },
  }),
  repository: { full_name: payload.repository?.full_name, default_branch: payload.repository?.default_branch },
  sender: { login: payload.sender?.login },
});

type Payload = ReturnType<typeof eventPayload>;

/** Where a run's replies go: an issue or a pull request. */
export type Thread = { repo: string; issue: number };

/** The prompt for a run that an issue or a comment started. */
export const prompt = (event: string, payload: Payload) => {
  const { issue, comment, repository } = payload;
  const kind = issue.pull_request ? "pull request" : "issue";
  const lines = [
    `You're working in ${repository.full_name}, on ${kind} #${issue.number}: ${issue.title}`,
    "",
  ];
  if (event === "issue_comment") {
    lines.push(
      `@${issue.user.login} opened it with:`,
      issue.body ?? "",
      "",
      `@${comment!.user.login} commented:`,
      comment!.body,
    );
  } else {
    lines.push(`@${issue.user.login} ${payload.action} it with:`, issue.body ?? "");
  }
  lines.push(
    "",
    `Your final message is posted as a comment on the ${kind}. The gh CLI is signed in for ${repository.full_name}.`,
  );
  return lines.join("\n");
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

/** One GitHub App's webhook. A delivery's scope is its repo. */
export const channel = (ctx: ChannelContext): Channel<GithubEvent> => {
  const appId = ctx.value(CHANNEL_VALUES.appId);
  const rootKey = () => ctx.secret(CHANNEL_SECRETS.rootKey);
  const auth = async () => ({ appId, privateKey: await ctx.secret(CHANNEL_SECRETS.privateKey) });
  return {
    async receive(request) {
      const target = request.headers.get("x-github-hook-installation-target-id");
      if (target !== appId) {
        return { status: "rejected", reason: `delivery for App ${target}, not ${appId}` };
      }

      const body = new Uint8Array(await request.arrayBuffer());
      const secret = await webhookSecret(await rootKey(), appId);
      const signature = request.headers.get("x-hub-signature-256");
      if (!(await verifySignature(secret, body, signature))) {
        return { status: "rejected", reason: "bad signature" };
      }

      const event = request.headers.get("x-github-event") ?? "";
      const payload = JSON.parse(new TextDecoder().decode(body));
      const changes = sourceChanges(event, payload);
      if (changes?.length) return { status: "source", changes };
      const repo: string | undefined = payload.repository?.full_name;
      const data = parse(event, payload);
      if (!repo || !data) return { status: "ignored", reason: event };
      // The App's own replies would otherwise start runs.
      const post = event === "issue_comment" ? payload.comment : payload.issue;
      if (String(post?.performed_via_github_app?.id ?? "") === appId) {
        return { status: "ignored", reason: "posted by this App" };
      }
      return {
        status: "accepted",
        delivery: {
          id: request.headers.get("x-github-delivery") ?? "",
          scope: repo,
          repo,
          event,
          data,
          payload: eventPayload(payload),
        },
      };
    },

    match(selector, delivery) {
      const s = selector as Selector;
      return selects(s, delivery.data)
        ? checkAuthor(s.from, delivery.data)
        : undefined;
    },

    async sync(url) {
      await setWebhookConfig({
        appId,
        privateKey: await ctx.secret(CHANNEL_SECRETS.privateKey),
        rootKey: await rootKey(),
        url,
      });
    },

    async read(repo, dir, ref) {
      return readDir(await auth(), repo, dir, ref);
    },

    async writeStatus(repo, status) {
      await writeRepoStatus(await auth(), repo, status);
    },

    async writeCheck(repo, ref, check) {
      await writeRepoCheck(await auth(), repo, ref, check);
    },

    conversation(delivery) {
      const payload = delivery.payload as Payload;
      const thread: Thread = { repo: delivery.repo, issue: payload.issue.number };
      return {
        id: `github:${thread.repo}#${thread.issue}`.toLowerCase(),
        prompt: prompt(delivery.event, payload),
        thread,
      };
    },

    async reply(thread, text) {
      const { repo, issue } = thread as Thread;
      await comment(await auth(), repo, issue, text);
    },

    async token(repo, permissions) {
      return repoToken(await auth(), repo, permissions);
    },
  };
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
