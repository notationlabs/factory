import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { cloudflare } from "./cloudflare-api.ts";

/** What the deployer's builds token may do: create outpost Workers and their Artifacts repos, and build them. */
const PERMISSIONS = [
  ["workers_scripts", "edit"],
  ["containers", "edit"],
  ["cloudchamber", "edit"],
  ["workers_ci", "edit"],
  ["artifacts", "read"],
  ["artifacts", "edit"],
  ["account_settings", "read"],
].map(([key, type]) => ({ key, type }));

const openBrowser = (url: string) => {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  execFile(cmd, [url], () => {});
};

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The id of a user API token, which also checks that the token is active. */
export const verifyUserToken = async (token: string) =>
  (await cloudflare<{ id: string; status: string }>(token, "GET", "/user/tokens/verify")).id;

/**
 * Asks you for a user API token, since Cloudflare has no API that creates
 * one for an account token:
 * 1. A local server serves a page with a link to the dashboard's create-token
 *    page, filled in with the token's name, account and permissions.
 * 2. You create the token, and paste it into the local page.
 * 3. The token is checked against the API.
 */
export const askForBuildsToken = async (params: { name: string; accountId: string }) => {
  const query = new URLSearchParams({
    permissionGroupKeys: JSON.stringify(PERMISSIONS),
    accountId: params.accountId,
    zoneId: "all",
    name: params.name,
  });
  const dashboard = `https://dash.cloudflare.com/profile/api-tokens?${query}`;
  const state = randomBytes(16).toString("hex");
  let resolve!: (created: { TokenId: string; Value: string }) => void;
  const promise = new Promise<{ TokenId: string; Value: string }>((res) => {
    resolve = res;
  });
  const page = (note = "") => `<!doctype html><meta charset="utf-8"><title>Notation Factory</title>
<body style="font-family:system-ui;max-width:40rem;margin:3rem auto;line-height:1.5">
<h1>Cloudflare API token for the deployer</h1>
<p>Workers Builds needs a user API token. ${note}</p>
<ol>
<li><a href="${escape(dashboard)}" target="_blank" rel="noopener">Create the token</a>. The page fills in its name, account and permissions. Keep them as they are.</li>
<li>Paste the token here.</li>
</ol>
<form method="post" action="/token?state=${state}">
<input name="token" type="password" autocomplete="off" required style="width:100%;font-size:1rem;padding:.4rem">
<p><button type="submit">Save token</button></p>
</form></body>`;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: string) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    };
    if (req.method === "GET" && url.pathname === "/") return send(200, page());
    if (req.method !== "POST" || url.pathname !== "/token" || url.searchParams.get("state") !== state) {
      return send(404, "not found");
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const value = new URLSearchParams(Buffer.concat(chunks).toString("utf8")).get("token")?.trim() ?? "";
    try {
      const TokenId = await verifyUserToken(value);
      send(200, "<p style='font-family:system-ui'>Token saved. You can close this tab.</p>");
      resolve({ TokenId, Value: value });
    } catch {
      send(400, page("<strong>Cloudflare didn't accept that token. Check it, and paste it again.</strong>"));
    }
  });

  await new Promise<void>((listening) => server.listen(0, "localhost", listening));
  const { port } = server.address() as AddressInfo;
  const start = `http://localhost:${port}/`;
  console.error(`Create the deployer's Cloudflare API token in your browser: ${start}`);
  openBrowser(start);
  try {
    return await promise;
  } finally {
    server.close();
  }
};
