import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { GithubEvent, Permissions } from "./permissions.ts";

const GITHUB_WEB = "https://github.com";
const GITHUB_API = "https://api.github.com";
const HOMEPAGE = "https://github.com/notationlabs/factory";

const github = async <T>(
  method: string,
  path: string,
  token?: string,
): Promise<T> => {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "notation-factory",
      "x-github-api-version": "2022-11-28",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub ${method} ${path}: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
};

/** The token of your gh login, if there is one: `GH_TOKEN` wins, as it does for gh itself. */
const ghToken = () =>
  new Promise<string | undefined>((resolve) => {
    if (process.env.GH_TOKEN) return resolve(process.env.GH_TOKEN);
    execFile("gh", ["auth", "token"], (error, stdout) =>
      resolve(error ? undefined : stdout.trim() || undefined),
    );
  });

const openBrowser = (url: string) => {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer"
        : "xdg-open";
  execFile(cmd, [url], () => {});
};

/**
 * Creates the App with GitHub's manifest flow:
 *
 * 1. A local server serves a page that posts the manifest to GitHub's new
 *    App form, under `org` if there is one, otherwise under your account.
 * 2. You confirm the App in the browser, and GitHub redirects to the local
 *    server with a one-time code.
 * 3. The code is exchanged for the App, which includes its private key.
 */
export const createApp = async (params: {
  name: string;
  org?: string;
  hookUrl: string;
  events?: GithubEvent[];
  permissions?: Permissions;
}): Promise<{ slug: string; id: string; privateKey: string }> => {
  const state = randomBytes(16).toString("hex");
  type Created = { slug: string; id: string; privateKey: string };
  let resolve!: (app: Created) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Created>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: string, type = "text/plain") => {
      res.writeHead(status, { "content-type": type });
      res.end(body);
    };
    if (url.pathname === "/") {
      const { port } = server.address() as AddressInfo;
      const manifest = {
        name: params.name,
        url: HOMEPAGE,
        hook_attributes: { url: params.hookUrl, active: true },
        redirect_url: `http://localhost:${port}/callback`,
        // An App on a personal account is public, so that orgs can install it.
        public: !params.org,
        default_events: params.events ?? [],
        default_permissions: params.permissions ?? {},
      };
      const owner = params.org ? `/organizations/${params.org}` : "";
      const action = `${GITHUB_WEB}${owner}/settings/apps/new?state=${state}`;
      const value = JSON.stringify(manifest)
        .replace(/&/g, "&amp;")
        .replace(/'/g, "&#39;");
      return send(
        200,
        `<form id="f" method="post" action="${action}"><input type="hidden" name="manifest" value='${value}'></form><script>f.submit()</script>`,
        "text/html",
      );
    }
    const code = url.searchParams.get("code");
    if (
      url.pathname !== "/callback" ||
      !code ||
      url.searchParams.get("state") !== state
    ) {
      return send(404, "not found");
    }
    try {
      const app = await github<{ id: number; slug: string; pem: string }>(
        "POST",
        `/app-manifests/${encodeURIComponent(code)}/conversions`,
      );
      resolve({ slug: app.slug, id: String(app.id), privateKey: app.pem });
      send(200, "App created. You can close this tab.");
    } catch (error) {
      reject(error);
      send(500, "Creating the App failed. See the terminal.");
    }
  });

  await new Promise<void>((listening) =>
    server.listen(0, "localhost", listening),
  );
  const { port } = server.address() as AddressInfo;
  const start = `http://localhost:${port}/`;
  console.error(`Create the GitHub App ${params.name} in your browser: ${start}`);
  openBrowser(start);
  try {
    return await promise;
  } finally {
    server.close();
  }
};

/** Reads the App by its slug. GitHub only shows a private App to its owner, so this uses your gh login when there is one. */
export const readApp = async (key: {
  slug: string;
}): Promise<{ slug: string; id: string }> => {
  const app = await github<{ id: number; slug: string }>(
    "GET",
    `/apps/${encodeURIComponent(key.slug)}`,
    await ghToken(),
  );
  return { slug: app.slug, id: String(app.id) };
};

/** GitHub has no API for an App's events and permissions: they're changed on its settings page, and installs approve new permissions. */
export const requestAppChange = async (
  _key: { slug: string },
  _change: { events?: GithubEvent[]; permissions?: Permissions },
): Promise<void> => {
  throw new Error(
    "not implemented: change the App's events and permissions on its settings page",
  );
};
