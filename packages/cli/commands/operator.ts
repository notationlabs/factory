import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SessionResult, SignInResult } from "@notation/factory/router";
import { OPERATOR_CALLBACK_URL } from "@notation/factory-github/app";
import { openBrowser } from "./shell.ts";

/** Where the CLI keeps each hub's admin session, by the router's origin. */
const SESSIONS_FILE = join(homedir(), ".config", "notation-factory", "sessions.json");

/** A cached session that expires within this time is not used, so that it doesn't expire mid-command. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

type Sessions = Record<string, SessionResult>;

const readSessions = async (): Promise<Sessions> => {
  try {
    return JSON.parse(await readFile(SESSIONS_FILE, "utf8")) as Sessions;
  } catch {
    return {};
  }
};

const saveSession = async (origin: string, session: SessionResult | undefined) => {
  const sessions = await readSessions();
  if (session) sessions[origin] = session;
  else delete sessions[origin];
  await mkdir(dirname(SESSIONS_FILE), { recursive: true });
  await writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2), { mode: 0o600 });
  // `mode` only applies when writeFile creates the file.
  await chmod(SESSIONS_FILE, 0o600);
};

const post = async <T>(router: string, path: string, body: unknown): Promise<T> => {
  const response = await fetch(new URL(path, router), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(`The hub refused the sign-in: ${result.error ?? `status ${response.status}`}`);
  return result;
};

/**
 * Signs in to the hub at `router` in the browser:
 * 1. Listens for the browser on the callback URL that the App allows.
 * 2. Asks the router for its sign-in page, and opens it.
 * 3. Takes the code that the page sends to the callback, and exchanges it
 *    with the router for an admin session.
 */
const signIn = async (router: string): Promise<SessionResult> => {
  const state = randomBytes(16).toString("hex");
  const callback = new URL(OPERATOR_CALLBACK_URL);
  let resolve!: (code: string) => void;
  let reject!: (error: Error) => void;
  const code = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", callback.origin);
    const send = (status: number, body: string) => {
      res.writeHead(status, { "content-type": "text/plain" });
      res.end(body);
    };
    if (url.pathname !== callback.pathname || url.searchParams.get("state") !== state) return send(404, "not found");
    const error = url.searchParams.get("error");
    const found = url.searchParams.get("code");
    if (error || !found) {
      send(400, "The sign-in didn't finish. See the terminal.");
      reject(new Error(`The sign-in didn't finish: ${url.searchParams.get("error_description") ?? error ?? "GitHub sent no code"}`));
      return;
    }
    send(200, "Signed in. You can close this tab.");
    resolve(found);
  });
  await new Promise<void>((listening, failed) => {
    server.once("error", (error: NodeJS.ErrnoException) =>
      failed(
        error.code === "EADDRINUSE"
          ? new Error(`Signing in needs port ${callback.port}, which another program is using.`)
          : error,
      ),
    );
    server.listen(Number(callback.port), callback.hostname, listening);
  });
  const timeout = setTimeout(() => reject(new Error("The sign-in didn't finish within 5 minutes.")), SIGN_IN_TIMEOUT_MS);
  try {
    const { url } = await post<SignInResult>(router, "/admin/sign-in", { state });
    console.error(`Sign in to the hub in your browser: ${url}`);
    openBrowser(url);
    const session = await post<SessionResult>(router, "/admin/session", { code: await code });
    console.error(`Signed in to the hub as ${session.operator}.`);
    return session;
  } finally {
    clearTimeout(timeout);
    server.close();
  }
};

/** The admin session for the hub at `router`: the cached one if it's still good, or a new one. */
const session = async (router: string) => {
  const { origin } = new URL(router);
  const cached = (await readSessions())[origin];
  if (cached && cached.expires - EXPIRY_MARGIN_MS > Date.now()) return cached.session;
  const fresh = await signIn(router);
  await saveSession(origin, fresh);
  return fresh.session;
};

/** Calls an admin route of the hub at `router`. A refused session is dropped, and the operator signs in again once. */
export const admin = async <T>(router: string, method: string, path: string, body?: unknown): Promise<T> => {
  const call = async () =>
    fetch(new URL(path, router), {
      method,
      headers: {
        authorization: `Bearer ${await session(router)}`,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  let response = await call();
  if (response.status === 401) {
    await saveSession(new URL(router).origin, undefined);
    response = await call();
  }
  const result = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(`The hub's ${method} ${path} failed: ${result.error ?? `status ${response.status}`}`);
  return result;
};
