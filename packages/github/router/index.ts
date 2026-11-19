import {
  type AuthorCheck,
  type Channel,
  type ChannelContext,
  type Delivery,
  deriveKey,
  hmacHex,
  timingSafeEqual,
} from "@notation/factory/router";
import type { AuthorSet } from "../implementations/selectors.ts";
import { appJwt } from "./app-jwt.ts";
import {
  comment,
  type IssueComment,
  issueComments,
  PUSH_ROLES,
  readDir,
  repoToken,
  roles,
  sourceChanges,
  writeCheck as writeRepoCheck,
  writeStatus as writeRepoStatus,
} from "./repos.ts";

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

/**
 * Someone who posted to a thread. `bot` is set for an App or another bot
 * account. `role` is their role on the repo, if GitHub said, and `write` is
 * whether that role can push.
 */
export type Author = { login: string; bot: boolean; role?: string; write: boolean };

/** The parts of an issue or comment event that selectors read. */
export type GithubEvent = {
  action: string;
  /** The author of the comment, or of the issue. */
  author: Author;
  body: string;
  /** The body before an edit. The same as `body` when an edit didn't change it. */
  before: string;
  labels: string[];
};

type Post = {
  body?: string | null;
  user?: { login: string; type?: string };
};

const authorOf = (post: Post): Author => ({
  login: post.user?.login ?? "",
  bot: post.user?.type === "Bot",
  write: false,
});

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
    author: authorOf(post),
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
    user: { login: payload.issue.user?.login, type: payload.issue.user?.type },
    ...(payload.issue.pull_request && { pull_request: { url: payload.issue.pull_request.url } }),
  },
  ...(payload.comment && {
    comment: { id: payload.comment.id, body: payload.comment.body, user: { login: payload.comment.user?.login } },
  }),
  repository: { full_name: payload.repository?.full_name, default_branch: payload.repository?.default_branch },
  sender: { login: payload.sender?.login },
});

type Payload = ReturnType<typeof eventPayload>;

/** Where a run's replies go: an issue or a pull request, and the agent whose replies they are. */
export type Thread = { repo: string; issue: number; agent?: string };

/** One message in an issue's thread: its opening post or a comment. `agent` is set on a reply from one of the hub's agents. */
type Message = { author: Author; body: string; agent?: string };

/** The hidden marker at the start of an agent's reply, which names the agent. */
const agentMarker = (agent: string) => `<!-- factory:agent=${agent} -->`;
const AGENT_MARKER = /^<!-- factory:agent=([\w.-]+) -->\n?/;

/** The comment as a message. Only this App's comments can name an agent. */
const commentMessage = (c: IssueComment, appId: string): Message => {
  const body = c.body ?? "";
  const marker = String(c.performed_via_github_app?.id ?? "") === appId ? body.match(AGENT_MARKER) : null;
  return {
    author: authorOf(c),
    body: marker ? body.slice(marker[0].length) : body,
    ...(marker && { agent: marker[1] }),
  };
};

const attribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

/**
 * The message as a `<message>` tag. Its body can't open or close a tag of
 * its own, so it can't pose as another message. Bots other than the hub's
 * agents can't trigger agents, so their tag names only the bot.
 */
const render = (m: Message, from: Selector["from"]) => {
  const fields: [string, string][] = [["user", `@${m.author.login}`]];
  if (m.agent) fields.push(["agent", m.agent]);
  else if (!m.author.bot) {
    fields.push(["role", m.author.role ?? "unknown"], ["can_trigger_agent", String(checkAuthor(from, m.author).result === "allowed")]);
  }
  const attributes = fields.map(([name, value]) => `${name}="${attribute(value)}"`).join(" ");
  const body = m.body.replace(/<(\/?message)/gi, "&lt;$1");
  return `<message ${attributes}>\n${body}\n</message>`;
};

/**
 * The run's prompt: the messages since the agent's last reply, then the
 * message that started the run.
 */
export const prompt = (recent: Message[], user: Message, from: Selector["from"]) => {
  const parts: string[] = [];
  if (recent.length > 0) parts.push("### Messages in thread since last turn", ...recent.map((m) => render(m, from)));
  parts.push("### User message", render(user, from));
  return parts.join("\n\n");
};

const context = (repo: string, kind: string, issue: Payload["issue"]) =>
  `The ${kind} is ${repo}#${issue.number}: ${issue.title}. The gh CLI is signed in for ${repo}.

A message's role is its author's role on the repo. admin, maintain and write can push. triage can manage issues and pull requests, but can't push. read can only read. none has no access. A message with agent is a reply from that agent on this hub. A message from any other bot has neither, and bots can't trigger agents.`;

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

const checkOne = (sets: AuthorSet[], author: Author): AuthorCheck => {
  if (author.bot) return { result: "denied" };
  const allowed = sets.some((s) =>
    s.kind === "user"
      ? s.login.toLowerCase() === author.login.toLowerCase()
      : s.kind === "collaborators" && author.write,
  );
  if (allowed) return { result: "allowed" };
  const teams = sets.filter((s) => s.kind === "team");
  return teams.length ? { result: "check", sets: teams } : { result: "denied" };
};

/** Whether `author` may start a run. Bots never match. */
const checkAuthor = (from: Selector["from"], author: Author): AuthorCheck =>
  checkOne(Array.isArray(from) ? from : [from], author);

/**
 * Sets `role` and `write` on the people among `authors`, by asking GitHub.
 * If GitHub can't answer, they stay without a role.
 */
const resolveRoles = async (auth: { appId: string; privateKey: string }, repo: string, authors: Author[]) => {
  const people = authors.filter((a) => !a.bot && a.login && a.role === undefined);
  if (people.length === 0) return;
  try {
    const found = await roles(auth, repo, [...new Set(people.map((a) => a.login))]);
    for (const a of people) {
      a.role = found.get(a.login);
      a.write = PUSH_ROLES.has(a.role ?? "");
    }
  } catch (error) {
    console.log(JSON.stringify({ state: "role check failed", repo, error: error instanceof Error ? error.message : String(error) }));
  }
};

/**
 * The messages for a run: the message that started it, and the messages
 * before it since the agent's last reply. With no reply from the agent,
 * they start at the issue's opening post. An issue event's message is the
 * opening post, so it has none before it.
 */
const threadMessages = async (
  auth: { appId: string; privateKey: string },
  delivery: Delivery<GithubEvent>,
  agent: string,
) => {
  const payload = delivery.payload as Payload;
  const opening: Message = { author: authorOf(payload.issue), body: payload.issue.body ?? "" };
  const user: Message = { author: delivery.data.author, body: delivery.data.body };
  if (delivery.event !== "issue_comment") return { recent: [], user };
  const comments = await issueComments(auth, delivery.repo, payload.issue.number);
  const at = comments.findIndex((c) => c.id === payload.comment!.id);
  const before = [opening, ...comments.slice(0, at === -1 ? comments.length : at).map((c) => commentMessage(c, auth.appId))];
  let last = before.length - 1;
  while (last >= 0 && before[last]!.agent !== agent) last--;
  const recent = before.slice(last + 1);
  await resolveRoles(auth, delivery.repo, recent.map((m) => m.author));
  return { recent, user };
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
      await resolveRoles(await auth(), repo, [data.author]);
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
        ? checkAuthor(s.from, delivery.data.author)
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

    async conversation(delivery, { selector, agent }) {
      const payload = delivery.payload as Payload;
      const { issue } = payload;
      const kind = issue.pull_request ? "pull request" : "issue";
      const thread: Thread = { repo: delivery.repo, issue: issue.number, agent };
      const { recent, user } = await threadMessages(await auth(), delivery, agent);
      return {
        id: `github:${thread.repo}#${thread.issue}`.toLowerCase(),
        prompt: prompt(recent, user, (selector as Selector).from),
        thread,
        channel: `GitHub ${kind}`,
        context: context(delivery.repo, kind, issue),
      };
    },

    async reply(thread, text) {
      const { repo, issue, agent } = thread as Thread;
      await comment(await auth(), repo, issue, agent ? `${agentMarker(agent)}\n${text}` : text);
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
