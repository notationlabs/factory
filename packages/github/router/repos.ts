import type { FactoryStatus, SourceChange, SourceFiles } from "@notation/factory/router";
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

/**
 * The files under `dir` in `repo` at `ref`, or at the default branch's head:
 * 1. Resolves the ref to a commit and its tree.
 * 2. Lists the tree, and keeps the files under `dir`.
 * 3. Reads each file as text.
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
  ).json()) as { truncated: boolean; tree: { path: string; type: string; sha: string; size?: number }[] };
  const prefix = `${dir}/`;
  const blobs = tree.tree.filter((e) => e.type === "blob" && e.path.startsWith(prefix));
  if (tree.truncated && blobs.length === 0) {
    throw new Error(`${repo}'s tree is too large for GitHub to list in one response.`);
  }
  if (blobs.length > MAX_FILES) {
    throw new Error(`${repo} has ${blobs.length} files in ${dir}/. The most the hub reads is ${MAX_FILES}.`);
  }
  const files: Record<string, string> = {};
  for (const blob of blobs) {
    if ((blob.size ?? 0) > MAX_FILE_BYTES) {
      throw new Error(`${blob.path} is larger than ${MAX_FILE_BYTES / 1024} KB.`);
    }
    const response = await ok(
      await github("GET", `/repos/${repo}/git/blobs/${blob.sha}`, token, { accept: "application/vnd.github.raw+json" }),
      `GET /repos/${repo}/git/blobs/${blob.sha}`,
    );
    files[blob.path.slice(prefix.length)] = await response.text();
  }
  return { ref: commit.sha, files };
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
