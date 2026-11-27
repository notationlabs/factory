import type { BuildCheck, FactoryStatus, SourceChange, SourceFiles } from "@notation/factory/router";
import { appJwt } from "./app-jwt.ts";

const GITHUB_API = "https://api.github.com";

/** The most files, and the largest file, that `readDir` reads. */
const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024;

/** GitHub's limit on an Actions variable's value is 48 KB, so long errors are cut. */
const MAX_ERROR_CHARS = 8000;

export type AppAuth = { appId: string; privateKey: string };

const github = async (
  method: string,
  path: string,
  token: string,
  { body, accept = "application/vnd.github+json" }: { body?: unknown; accept?: string } = {},
) => {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "User-Agent": "notation-factory-router",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response;
};

const ok = async (response: Response, what: string) => {
  if (!response.ok) {
    throw new Error(`GitHub ${what} failed with status ${response.status}: ${await response.text()}`);
  }
  return response;
};

/** An installation token for `repo` alone, with only `permissions`. */
export const repoToken = async (
  { appId, privateKey }: AppAuth,
  repo: string,
  permissions: Record<string, "read" | "write">,
) => {
  const jwt = await appJwt(appId, privateKey);
  const installation = (await (
    await ok(await github("GET", `/repos/${repo}/installation`, jwt), `GET /repos/${repo}/installation`)
  ).json()) as { id: number };
  const { token } = (await (
    await ok(
      await github("POST", `/app/installations/${installation.id}/access_tokens`, jwt, {
        body: { repositories: [repo.split("/")[1]], permissions },
      }),
      `POST /app/installations/${installation.id}/access_tokens`,
    )
  ).json()) as { token: string };
  return token;
};

/** Roles that let a user push to a repo. */
export const PUSH_ROLES = new Set(["admin", "maintain", "write"]);

/**
 * Each login's role on `repo`, asked of GitHub: `admin`, `maintain`,
 * `write`, `triage`, `read`, an org's custom role, or `none`.
 */
export const roles = async (auth: AppAuth, repo: string, logins: string[]) => {
  const token = await repoToken(auth, repo, { metadata: "read" });
  const role = async (login: string) => {
    const path = `/repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`;
    const response = await github("GET", path, token);
    if (response.status === 404) return "none";
    const { permission, role_name } = (await (await ok(response, `GET ${path}`)).json()) as {
      permission: string;
      role_name?: string;
    };
    return role_name || permission;
  };
  return new Map(await Promise.all(logins.map(async (login) => [login, await role(login)] as const)));
};

/** How long `collaborators` keeps each answer. A collaborator added or removed in that time isn't noticed yet. */
const COLLABORATOR_TTL_MS = 10 * 60 * 1000;

const collaboratorCache = new Map<string, { collaborator: boolean; expires: number }>();

/**
 * The logins among `logins` that are collaborators on `repo`, including org
 * members with access. Each App keeps each answer for `COLLABORATOR_TTL_MS`,
 * so it asks GitHub only about logins it hasn't seen recently.
 */
export const collaborators = async (auth: AppAuth, repo: string, logins: string[]) => {
  const now = Date.now();
  const key = (login: string) => `${auth.appId}:${repo}:${login}`.toLowerCase();
  const unknown = logins.filter((login) => (collaboratorCache.get(key(login))?.expires ?? 0) <= now);
  if (unknown.length) {
    const token = await repoToken(auth, repo, { metadata: "read" });
    await Promise.all(
      unknown.map(async (login) => {
        const path = `/repos/${repo}/collaborators/${encodeURIComponent(login)}`;
        const response = await github("GET", path, token);
        if (response.status !== 404) await ok(response, `GET ${path}`);
        collaboratorCache.set(key(login), { collaborator: response.status === 204, expires: now + COLLABORATOR_TTL_MS });
      }),
    );
  }
  return logins.filter((login) => collaboratorCache.get(key(login))?.collaborator);
};

/**
 * The files under `dir` in `repo` at `ref`, or at the default branch's head:
 * 1. Resolves the ref to a commit and its tree.
 * 2. Lists the tree, and keeps the files under `dir`.
 * 3. Reads each file as text, and notes which are executable.
 */
export const readDir = async (
  auth: AppAuth,
  repo: string,
  dir: string,
  ref?: string,
): Promise<SourceFiles> => {
  const token = await repoToken(auth, repo, { contents: "read" });
  const branch =
    ref ??
    ((await (await ok(await github("GET", `/repos/${repo}`, token), `GET /repos/${repo}`)).json()) as {
      default_branch: string;
    }).default_branch;
  const commit = (await (
    await ok(await github("GET", `/repos/${repo}/commits/${encodeURIComponent(branch)}`, token), `GET /repos/${repo}/commits/${branch}`)
  ).json()) as { sha: string; commit: { tree: { sha: string } } };
  const tree = (await (
    await ok(
      await github("GET", `/repos/${repo}/git/trees/${commit.commit.tree.sha}?recursive=1`, token),
      `GET /repos/${repo}/git/trees`,
    )
  ).json()) as { truncated: boolean; tree: { path: string; mode: string; type: string; sha: string; size?: number }[] };
  const prefix = `${dir}/`;
  const blobs = tree.tree.filter((e) => e.type === "blob" && e.path.startsWith(prefix));
  if (tree.truncated && blobs.length === 0) {
    throw new Error(`${repo}'s tree is too large for GitHub to list in one response.`);
  }
  if (blobs.length > MAX_FILES) {
    throw new Error(`${repo} has ${blobs.length} files in ${dir}/. The most the hub reads is ${MAX_FILES}.`);
  }
  const files: Record<string, string> = {};
  const executables: string[] = [];
  for (const blob of blobs) {
    if ((blob.size ?? 0) > MAX_FILE_BYTES) {
      throw new Error(`${blob.path} is larger than ${MAX_FILE_BYTES / 1024} KB.`);
    }
    const response = await ok(
      await github("GET", `/repos/${repo}/git/blobs/${blob.sha}`, token, { accept: "application/vnd.github.raw+json" }),
      `GET /repos/${repo}/git/blobs/${blob.sha}`,
    );
    const path = blob.path.slice(prefix.length);
    files[path] = await response.text();
    if (blob.mode === "100755") executables.push(path);
  }
  return { ref: commit.sha, files, ...(executables.length && { executables }) };
};

const STATUS_VARIABLE = "FACTORY_STATUS";

/** Writes `status` to the repo's `FACTORY_STATUS` Actions variable, as JSON. */
export const writeStatus = async (auth: AppAuth, repo: string, status: FactoryStatus) => {
  const token = await repoToken(auth, repo, { actions_variables: "write" });
  const value = JSON.stringify({
    ...status,
    ...(status.error ? { error: status.error.slice(0, MAX_ERROR_CHARS) } : {}),
  });
  const updated = await github("PATCH", `/repos/${repo}/actions/variables/${STATUS_VARIABLE}`, token, {
    body: { name: STATUS_VARIABLE, value },
  });
  if (updated.status !== 404) return void (await ok(updated, `PATCH ${STATUS_VARIABLE} on ${repo}`));
  await ok(
    await github("POST", `/repos/${repo}/actions/variables`, token, { body: { name: STATUS_VARIABLE, value } }),
    `POST ${STATUS_VARIABLE} on ${repo}`,
  );
};

/**
 * Creates or updates the App's check run named `check.name` on commit `ref`.
 * A finished check gets the conclusion of its state.
 */
export const writeCheck = async (auth: AppAuth, repo: string, ref: string, check: BuildCheck) => {
  const token = await repoToken(auth, repo, { checks: "write" });
  const listed = (await (
    await ok(
      await github("GET", `/repos/${repo}/commits/${ref}/check-runs?check_name=${encodeURIComponent(check.name)}&app_id=${auth.appId}`, token),
      `GET /repos/${repo}/commits/${ref}/check-runs`,
    )
  ).json()) as { check_runs: { id: number }[] };
  const done = check.state !== "queued" && check.state !== "in_progress";
  const body = {
    name: check.name,
    head_sha: ref,
    status: done ? "completed" : check.state,
    ...(done && { conclusion: check.state }),
    ...(check.url && { details_url: check.url }),
    ...(check.summary && { output: { title: check.name, summary: check.summary } }),
  };
  const [run] = listed.check_runs;
  if (run) {
    await ok(await github("PATCH", `/repos/${repo}/check-runs/${run.id}`, token, { body }), `PATCH /repos/${repo}/check-runs/${run.id}`);
  } else {
    await ok(await github("POST", `/repos/${repo}/check-runs`, token, { body }), `POST /repos/${repo}/check-runs`);
  }
};

/** A comment on an issue or a pull request, as GitHub's API returns it. */
export type IssueComment = {
  id: number;
  body?: string | null;
  user?: { login: string; type?: string };
  performed_via_github_app?: { id: number } | null;
};

/** An issue's or a pull request's opening post. */
export const issuePost = async (auth: AppAuth, repo: string, issue: number) => {
  const token = await repoToken(auth, repo, { issues: "read" });
  const path = `/repos/${repo}/issues/${issue}`;
  return (await (await ok(await github("GET", path, token), `GET ${path}`)).json()) as Omit<IssueComment, "id">;
};

/** The comments on an issue or a pull request, oldest first. */
export const issueComments = async (auth: AppAuth, repo: string, issue: number) => {
  const token = await repoToken(auth, repo, { issues: "read" });
  const all: IssueComment[] = [];
  for (let page = 1; ; page++) {
    const path = `/repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`;
    const batch = (await (await ok(await github("GET", path, token), `GET ${path}`)).json()) as IssueComment[];
    all.push(...batch);
    if (batch.length < 100) return all;
  }
};

/** GitHub's limit on a comment's body. */
const MAX_COMMENT_CHARS = 65536;

/**
 * Comments `body` on an issue or a pull request, as the App, or replaces the
 * body of the App's comment `replace` on it. If that comment is gone, it
 * comments anew. Resolves to the comment's id.
 */
export const comment = async (auth: AppAuth, repo: string, issue: number, body: string, replace?: number) => {
  const token = await repoToken(auth, repo, { issues: "write" });
  const text = body.length > MAX_COMMENT_CHARS ? `${body.slice(0, MAX_COMMENT_CHARS - 20)}\n\n…(cut)` : body;
  if (replace !== undefined) {
    const path = `/repos/${repo}/issues/comments/${replace}`;
    const response = await github("PATCH", path, token, { body: { body: text } });
    if (response.status !== 404) {
      await ok(response, `PATCH ${path}`);
      return replace;
    }
  }
  const path = `/repos/${repo}/issues/${issue}/comments`;
  const response = await ok(await github("POST", path, token, { body: { body: text } }), `POST ${path}`);
  return ((await response.json()) as { id: number }).id;
};

/** Reacts with 👀 to a comment, or to an issue's opening post if there's no `comment`. */
export const reactEyes = async (auth: AppAuth, repo: string, target: { issue: number; comment?: number }) => {
  const token = await repoToken(auth, repo, { issues: "write" });
  const path =
    target.comment === undefined
      ? `/repos/${repo}/issues/${target.issue}/reactions`
      : `/repos/${repo}/issues/comments/${target.comment}/reactions`;
  await ok(await github("POST", path, token, { body: { content: "eyes" } }), `POST ${path}`);
};

/**
 * Removes the App's 👀 from a comment, or from an issue's opening post if
 * there's no `comment`.
 */
export const unreactEyes = async (auth: AppAuth, repo: string, target: { issue: number; comment?: number }) => {
  const token = await repoToken(auth, repo, { issues: "write" });
  const path =
    target.comment === undefined
      ? `/repos/${repo}/issues/${target.issue}/reactions`
      : `/repos/${repo}/issues/comments/${target.comment}/reactions`;
  // GitHub answers a reaction that the App has made already with that reaction, so this finds its id without listing every reaction.
  const response = await ok(await github("POST", path, token, { body: { content: "eyes" } }), `POST ${path}`);
  const { id } = (await response.json()) as { id: number };
  await ok(await github("DELETE", `${path}/${id}`, token), `DELETE ${path}/${id}`);
};

/** Adds labels to an issue or a pull request. GitHub creates a label that the repo doesn't have yet. */
export const addLabels = async (auth: AppAuth, repo: string, issue: number, labels: string[]) => {
  const token = await repoToken(auth, repo, { issues: "write" });
  const path = `/repos/${repo}/issues/${issue}/labels`;
  await ok(await github("POST", path, token, { body: { labels } }), `POST ${path}`);
};

const fullNames = (repos: { full_name: string }[] | undefined) => (repos ?? []).map((r) => r.full_name);

/**
 * The repos whose outposts a delivery changes:
 * - a push to the default branch, at the pushed commit
 * - an install or unsuspend, and repos added to an install, at the default branch
 * - an uninstall or suspend, and repos removed from an install, which the hub can no longer read
 */
export const sourceChanges = (event: string, payload: any): SourceChange[] | undefined => {
  if (event === "push") {
    const repo = payload.repository;
    if (!repo || payload.deleted || payload.ref !== `refs/heads/${repo.default_branch}`) return undefined;
    return [{ repo: repo.full_name, ref: payload.after }];
  }
  if (event === "installation") {
    const repos = fullNames(payload.repositories);
    if (payload.action === "created" || payload.action === "unsuspend") return repos.map((repo) => ({ repo }));
    if (payload.action === "deleted" || payload.action === "suspend") {
      return repos.map((repo) => ({ repo, removed: true }));
    }
    return undefined;
  }
  if (event === "installation_repositories") {
    return [
      ...fullNames(payload.repositories_added).map((repo) => ({ repo })),
      ...fullNames(payload.repositories_removed).map((repo) => ({ repo, removed: true })),
    ];
  }
  return undefined;
};

/** Every repo of every installation of the App that isn't suspended, as `owner/name`. */
export const installedRepos = async (auth: AppAuth) => {
  const jwt = await appJwt(auth.appId, auth.privateKey);
  const installations: { id: number; suspended_at?: string | null }[] = [];
  for (let page = 1; ; page++) {
    const path = `/app/installations?per_page=100&page=${page}`;
    const batch = (await (await ok(await github("GET", path, jwt), `GET ${path}`)).json()) as typeof installations;
    installations.push(...batch);
    if (batch.length < 100) break;
  }
  const repos: string[] = [];
  for (const installation of installations.filter((i) => !i.suspended_at)) {
    const { token } = (await (
      await ok(
        await github("POST", `/app/installations/${installation.id}/access_tokens`, jwt, { body: { permissions: { metadata: "read" } } }),
        `POST /app/installations/${installation.id}/access_tokens`,
      )
    ).json()) as { token: string };
    for (let page = 1; ; page++) {
      const path = `/installation/repositories?per_page=100&page=${page}`;
      const batch = (await (await ok(await github("GET", path, token), `GET ${path}`)).json()) as {
        repositories: { full_name: string }[];
      };
      repos.push(...fullNames(batch.repositories));
      if (batch.repositories.length < 100) break;
    }
  }
  return repos;
};
