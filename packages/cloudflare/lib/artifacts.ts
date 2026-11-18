import { cloudflare, cloudflareOrNone } from "./cloudflare-api.ts";

const namespacePath = (accountId: string, namespace: string) =>
  `/accounts/${accountId}/artifacts/namespaces/${encodeURIComponent(namespace)}`;

export type Repo = { id: string; name: string; remote: string };

export const createNamespace = (token: string, accountId: string, namespace: string) =>
  cloudflare(token, "POST", `/accounts/${accountId}/artifacts/namespaces`, { namespace });

export const getNamespace = (token: string, accountId: string, namespace: string) =>
  cloudflareOrNone(token, "GET", namespacePath(accountId, namespace));

/**
 * Deletes a namespace and its repos. Artifacts refuses to delete a namespace
 * with repos in it, and deletes a repo after it answers, so the namespace's
 * delete is retried until the repos are gone.
 */
export const deleteNamespace = async (token: string, accountId: string, namespace: string) => {
  const path = namespacePath(accountId, namespace);
  for (const repo of await listRepos(token, accountId, namespace)) {
    await cloudflareOrNone(token, "DELETE", `${path}/repos/${encodeURIComponent(repo.name)}`);
  }
  for (let attempt = 1; ; attempt++) {
    try {
      await cloudflareOrNone(token, "DELETE", path);
      return;
    } catch (error) {
      if (attempt === 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
};

const listRepos = async (token: string, accountId: string, namespace: string) => {
  const repos: { name: string }[] = [];
  let cursor = "";
  do {
    const query = new URLSearchParams({ limit: "100", ...(cursor && { cursor }) });
    const response = await fetch(
      `https://api.cloudflare.com/client/v4${namespacePath(accountId, namespace)}/repos?${query}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (response.status === 404) return repos;
    const body = (await response.json()) as {
      result?: { name: string }[];
      result_info?: { cursor?: string };
    };
    repos.push(...(body.result ?? []));
    cursor = body.result_info?.cursor ?? "";
  } while (cursor);
  return repos;
};

/** The repo `name` in `namespace`, which this creates if it doesn't exist. */
export const ensureRepo = async (token: string, accountId: string, namespace: string, name: string): Promise<Repo> => {
  const path = namespacePath(accountId, namespace);
  const found = await cloudflareOrNone<Repo>(token, "GET", `${path}/repos/${encodeURIComponent(name)}`);
  if (found) return found;
  return cloudflare<Repo>(token, "POST", `${path}/repos`, { name, default_branch: "main" });
};

export const deleteRepo = (token: string, accountId: string, namespace: string, name: string) =>
  cloudflareOrNone(token, "DELETE", `${namespacePath(accountId, namespace)}/repos/${encodeURIComponent(name)}`);

/** A write token for the repo `name`, which lasts `ttl` seconds. */
export const repoToken = async (token: string, accountId: string, namespace: string, name: string, ttl = 600) =>
  (
    await cloudflare<{ plaintext: string }>(token, "POST", `${namespacePath(accountId, namespace)}/tokens`, {
      repo: name,
      scope: "write",
      ttl,
    })
  ).plaintext;
