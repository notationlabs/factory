import { appJwt } from "./app-jwt.ts";
import type { AppAuth } from "./repos.ts";

const GITHUB_WEB = "https://github.com";
const GITHUB_API = "https://api.github.com";

const headers = (token: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "User-Agent": "notation-factory-router",
  "X-GitHub-Api-Version": "2022-11-28",
});

/** The App's client id, which GitHub's sign-in page names the App by. */
export const clientId = async ({ appId, privateKey }: AppAuth) => {
  const response = await fetch(`${GITHUB_API}/app`, { headers: headers(await appJwt(appId, privateKey)) });
  if (!response.ok) throw new Error(`GitHub GET /app failed with status ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { client_id: string }).client_id;
};

/** GitHub's page that signs a user in to the App, and sends their browser to `redirect`. */
export const signInUrl = (client: string, redirect: string, state: string) => {
  const url = new URL("/login/oauth/authorize", GITHUB_WEB);
  url.searchParams.set("client_id", client);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("state", state);
  return url.toString();
};

/**
 * The login of the user who signed in:
 * 1. Exchanges the code for a user access token, with the App's client secret.
 * 2. Asks GitHub whose token it is.
 * 3. Revokes the token, which the router has no other use for.
 */
export const signIn = async (app: { clientId: string; clientSecret: string }, code: string, redirect: string) => {
  const exchanged = await fetch(`${GITHUB_WEB}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "notation-factory-router" },
    body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: redirect }),
  });
  // GitHub answers a bad code with a 200 and an `error`.
  const result = (await exchanged.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!exchanged.ok || !result.access_token) {
    throw new Error(`GitHub refused the sign-in: ${result.error_description ?? result.error ?? `status ${exchanged.status}`}`);
  }
  const token = result.access_token;
  const user = await fetch(`${GITHUB_API}/user`, { headers: headers(token) });
  if (!user.ok) throw new Error(`GitHub GET /user failed with status ${user.status}: ${await user.text()}`);
  const { login } = (await user.json()) as { login: string };
  await fetch(`${GITHUB_API}/applications/${app.clientId}/token`, {
    method: "DELETE",
    headers: {
      ...headers(token),
      Authorization: `Basic ${btoa(`${app.clientId}:${app.clientSecret}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ access_token: token }),
  }).catch(() => {});
  return login;
};
