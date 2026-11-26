import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { OPERATOR_CALLBACK_URL } from "../router/operators.ts";
import type { GithubEvent, Permissions } from "./permissions.ts";

export { OPERATOR_CALLBACK_URL };

const GITHUB_WEB = "https://github.com";
const GITHUB_API = "https://api.github.com";
const HOMEPAGE = "https://github.com/notationlabs/factory";

const github = async <T>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<T> => {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
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
 * 3. The code is exchanged for the App, which includes its private key and
 *    its client secret.
 */
export const createApp = async (params: {
  name: string;
  org?: string;
  hookUrl: string;
  restartUrl?: string;
  events?: GithubEvent[];
  permissions?: Permissions;
}): Promise<{ id: string; clientId: string; privateKey: string; clientSecret: string }> => {
  const state = randomBytes(16).toString("hex");
  type Created = { id: string; clientId: string; privateKey: string; clientSecret: string };
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
        callback_urls: [OPERATOR_CALLBACK_URL, ...(params.restartUrl ? [params.restartUrl] : [])],
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
      const app = await github<{ id: number; slug: string; client_id: string; pem: string; client_secret: string }>(
        "POST",
        `/app-manifests/${encodeURIComponent(code)}/conversions`,
      );
      console.error(`Created the GitHub App ${app.slug}, with the ID ${app.id}. Outposts name the App by this ID in .factory/config.ts.`);
      resolve({ id: String(app.id), clientId: app.client_id, privateKey: app.pem, clientSecret: app.client_secret });
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

/**
 * The current slug of the App with id `id`, which changes when the App is
 * renamed. GitHub's REST API only finds an App by its slug, so this asks
 * GraphQL for the App's node. GitHub has deprecated this form of node ID, but
 * still resolves it, and its newer form includes the owner's ID.
 */
export const appSlug = async (id: string): Promise<string> => {
  const token = await ghToken();
  if (!token) {
    throw new Error(`Looking up the GitHub App ${id} needs a GitHub token. Run \`gh auth login\`, or set GH_TOKEN.`);
  }
  const nodeId = Buffer.from(`03:App${id}`).toString("base64");
  const { data, errors } = await github<{
    data?: { node?: { slug?: string } | null };
    errors?: { message: string }[];
  }>(
    "POST",
    "/graphql",
    token,
    { query: "query($id: ID!) { node(id: $id) { ... on App { slug } } }", variables: { id: nodeId } },
  );
  const slug = data?.node?.slug;
  if (!slug) throw new Error(`Looking up the GitHub App ${id} failed: ${errors?.[0]?.message ?? "GitHub returned no App"}`);
  return slug;
};

/**
 * The App's owner, and whether the App is public. Only the owner can install a
 * private App. GitHub only shows a private App to a request that's signed in.
 */
export const appVisibility = async (slug: string): Promise<{ owner: string; public: boolean }> => {
  const path = `/apps/${encodeURIComponent(slug)}`;
  const app = await github<{ owner: { login: string } }>("GET", path, await ghToken());
  const anonymous = await fetch(`${GITHUB_API}${path}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "notation-factory" },
  });
  return { owner: app.owner.login, public: anonymous.ok };
};

/** Reads the App by its id, which fails if the App is gone. The lookup needs your gh login or GH_TOKEN. */
export const readApp = async (key: { id: string }): Promise<{ id: string; clientId: string }> => {
  const slug = await appSlug(key.id);
  const app = await github<{ client_id: string }>("GET", `/apps/${encodeURIComponent(slug)}`, await ghToken());
  return { id: key.id, clientId: app.client_id };
};

/** Opens the App's advanced settings, where its owner must delete it. */
export const requestAppDeletion = async (key: { id: string; org?: string }): Promise<void> => {
  const slug = await appSlug(key.id);
  const owner = key.org ? `/organizations/${key.org}` : "";
  const url = `${GITHUB_WEB}${owner}/settings/apps/${slug}/advanced`;
  console.error(`Delete the GitHub App ${slug} on its settings page: ${url}`);
  openBrowser(url);
};

/**
 * GitHub has no API for an App's callback URLs, so this opens the App's
 * settings page and prints the URL to add there. It doesn't wait, since
 * GitHub's API doesn't show the callback URLs either.
 */
export const requestCallbackUrl = async (key: { id: string; org?: string }, url: string): Promise<void> => {
  const slug = await appSlug(key.id);
  const owner = key.org ? `/organizations/${key.org}` : "";
  const settings = `${GITHUB_WEB}${owner}/settings/apps/${slug}`;
  console.error(`Add ${url} as a callback URL of the GitHub App ${slug} on ${settings}, and save. Restart links of lost runs sign people in through it.`);
  openBrowser(settings);
};

/** How long a deploy waits for you to save an App's new permissions and events. */
const APP_CHANGE_TIMEOUT_MS = 15 * 60 * 1000;

const APP_CHANGE_POLL_MS = 5000;

/** The requested permissions and events that the App doesn't have yet. */
const missingFromApp = async (slug: string, change: { events?: GithubEvent[]; permissions?: Permissions }) => {
  const app = await github<{ permissions: Record<string, string>; events: string[] }>(
    "GET",
    `/apps/${encodeURIComponent(slug)}`,
    await ghToken(),
  );
  const permissions = Object.entries(change.permissions ?? {}).filter(
    ([name, level]) => app.permissions[name] !== "write" && app.permissions[name] !== level,
  );
  const events = (change.events ?? []).filter((event) => !app.events.includes(event));
  return { permissions, events };
};

/**
 * GitHub has no API for an App's events and permissions, so you change them
 * in the browser:
 * 1. Opens the App's permissions page, and prints what to set there.
 * 2. Waits until the App has them. Fails the deploy after 15 minutes.
 * 3. Opens the App's installations, where each installation accepts the new
 *    permissions. Deploy doesn't wait for that, since checking it needs the
 *    App's private key.
 */
export const requestAppChange = async (
  key: { id: string; org?: string },
  change: { events?: GithubEvent[]; permissions?: Permissions },
): Promise<void> => {
  const slug = await appSlug(key.id);
  let missing = await missingFromApp(slug, change);
  if (missing.permissions.length || missing.events.length) {
    const owner = key.org ? `/organizations/${key.org}` : "";
    const url = `${GITHUB_WEB}${owner}/settings/apps/${slug}/permissions`;
    console.error(
      [
        `Set the GitHub App ${slug}'s permissions and events on ${url}, and save:`,
        `  permissions: ${missing.permissions.map(([name, level]) => `${name}: ${level}`).join(", ") || "no change"}`,
        `  events: ${missing.events.join(", ") || "no change"}`,
      ].join("\n"),
    );
    openBrowser(url);
    const deadline = Date.now() + APP_CHANGE_TIMEOUT_MS;
    while (missing.permissions.length || missing.events.length) {
      if (Date.now() > deadline) {
        throw new Error(`The GitHub App ${slug} didn't get its new permissions and events within 15 minutes.`);
      }
      await new Promise((done) => setTimeout(done, APP_CHANGE_POLL_MS));
      missing = await missingFromApp(slug, change);
    }
  }
  const installations = `${GITHUB_WEB}/apps/${slug}/installations/new`;
  console.error(`Accept the GitHub App ${slug}'s new permissions on each installation: ${installations}`);
  openBrowser(installations);
};
