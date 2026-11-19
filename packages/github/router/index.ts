import {
  type AuthorCheck,
  type Channel,
  type ChannelContext,
  type Delivery,
  deriveKey,
  hmacHex,
  type ThreadMessage,
  timingSafeEqual,
} from "@notation/factory/router";
import type { AuthorSet } from "../implementations/selectors.ts";
import { appJwt } from "./app-jwt.ts";
import { signIn, signInUrl } from "./operators.ts";
import {
  comment,
  installedRepos,
  type IssueComment,
  issueComments,
  issuePost,
  PUSH_ROLES,
  reactEyes,
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
export const CHANNEL_SECRETS = { rootKey: "ROOT_KEY", privateKey: "PRIVATE_KEY", clientSecret: "CLIENT_SECRET" } as const;
export const CHANNEL_VALUES = { appId: "APP_ID", clientId: "CLIENT_ID" } as const;

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
  /**
   * Who acted, for an issue event that posted no message, such as adding a
   * label. The issue's author must match too, since the prompt quotes the
   * opening post.
   */
  actor?: Author;
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

/** Whether an issue or comment event with `action` posted a message. Other events, such as adding a label, start a run with what happened. */
const postsMessage = (action: string) => action === "opened" || action === "created" || action === "edited";

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
    ...(!postsMessage(payload.action) && payload.sender && { actor: authorOf({ user: payload.sender }) }),
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
  ...(payload.label && { label: { name: payload.label.name } }),
  repository: { full_name: payload.repository?.full_name, default_branch: payload.repository?.default_branch },
  sender: { login: payload.sender?.login },
});

type Payload = ReturnType<typeof eventPayload>;

/**
 * Where a run's replies go: an issue or a pull request, and the agent whose
 * replies they are. `from` is the run's trigger's, which decides who in the
 * thread can trigger the agent.
 */
export type Thread = { repo: string; issue: number; agent?: string; from?: AuthorSet | AuthorSet[] };

/** The hidden marker at the start of an agent's reply, which names the agent. */
const agentMarker = (agent: string) => `<!-- factory:agent=${agent} -->`;
const AGENT_MARKER = /^<!-- factory:agent=([\w.-]+) -->\n?/;

/** The post's author and body, and the agent that posted it. Only this App's posts can name an agent. */
const readPost = (post: Omit<IssueComment, "id">, appId: string) => {
  const body = post.body ?? "";
  const marker = String(post.performed_via_github_app?.id ?? "") === appId ? body.match(AGENT_MARKER) : null;
  return {
    author: authorOf(post),
    body: marker ? body.slice(marker[0].length) : body,
    agent: marker?.[1],
  };
};

/** The id of an issue's opening post among its thread's messages. Comments' ids are numbers. */
const OPENING_POST = "issue";

/** What happened to the issue, and who did it, for an event that posted no message, such as a label being added. */
const eventOf = (payload: Payload, kind: string) => {
  const { action } = payload;
  if (postsMessage(action)) return undefined;
  const by = payload.sender.login ? ` by @${payload.sender.login}` : "";
  if (action === "labeled") {
    const label = payload.label?.name ? ` \`${payload.label.name}\`` : "";
    return `The ${kind} was labelled${label}${by}.`;
  }
  return `The ${kind} was ${action}${by}.`;
};

/**
 * The messages in an issue's thread: its opening post, then its comments.
 * Each person's role comes from GitHub, and whether they can trigger the
 * agent from `from`.
 */
const threadMessages = async (
  auth: { appId: string; privateKey: string },
  { repo, issue, from = [] }: Thread,
): Promise<ThreadMessage[]> => {
  const [opening, comments] = await Promise.all([issuePost(auth, repo, issue), issueComments(auth, repo, issue)]);
  const posts = [
    { id: OPENING_POST, ...readPost(opening, auth.appId) },
    ...comments.map((c) => ({ id: String(c.id), ...readPost(c, auth.appId) })),
  ];
  await resolveRoles(auth, repo, posts.map((p) => p.author));
  return posts.map(({ id, author, body, agent }) => {
    const message: ThreadMessage = { id, author: `@${author.login}`, body };
    if (agent) message.agent = agent;
    else if (author.bot) message.bot = true;
    else {
      if (author.role) message.role = author.role;
      message.canTrigger = checkAuthor(from, author).result === "allowed";
    }
    return message;
  });
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

/** Whether the event's author, and its actor if it has one, may start a run. Both must be allowed. */
const checkEvent = (from: Selector["from"], event: GithubEvent): AuthorCheck => {
  const checks = [event.author, ...(event.actor ? [event.actor] : [])].map((a) => checkAuthor(from, a));
  if (checks.some((c) => c.result === "denied")) return { result: "denied" };
  return checks.find((c) => c.result === "check") ?? { result: "allowed" };
};

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
      await resolveRoles(await auth(), repo, [data.author, ...(data.actor ? [data.actor] : [])]);
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
        ? checkEvent(s.from, delivery.data)
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

    conversation(delivery, { selector, agent }) {
      const payload = delivery.payload as Payload;
      const { issue } = payload;
      const kind = issue.pull_request ? "pull request" : "issue";
      const { from } = selector as Selector;
      const thread: Thread = { repo: delivery.repo, issue: issue.number, agent, from };
      const event = eventOf(payload, kind);
      return {
        id: `github:${thread.repo}#${thread.issue}`.toLowerCase(),
        ...(event ? { event } : { message: payload.comment ? String(payload.comment.id) : OPENING_POST }),
        thread,
        channel: `GitHub ${kind}`,
        context: context(delivery.repo, kind, issue),
      };
    },

    async messages(thread) {
      return threadMessages(await auth(), thread as Thread);
    },

    async acknowledge(delivery) {
      const payload = delivery.payload as Payload;
      await reactEyes(await auth(), delivery.repo, { issue: payload.issue.number, comment: payload.comment?.id });
    },

    async reply(thread, text, message) {
      const { repo, issue, agent } = thread as Thread;
      const body = agent ? `${agentMarker(agent)}\n${text}` : text;
      const replace = message === undefined ? undefined : Number(message);
      return String(await comment(await auth(), repo, issue, body, Number.isInteger(replace) ? replace : undefined));
    },

    async token(repo, permissions) {
      return repoToken(await auth(), repo, permissions);
    },

    async repos() {
      return installedRepos(await auth());
    },

    async signInUrl(state) {
      return signInUrl(ctx.value(CHANNEL_VALUES.clientId), state);
    },

    async signIn(code) {
      return signIn({ clientId: ctx.value(CHANNEL_VALUES.clientId), clientSecret: await ctx.secret(CHANNEL_SECRETS.clientSecret) }, code);
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
