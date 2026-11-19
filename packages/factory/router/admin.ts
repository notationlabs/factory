import type { OperatorsEntry } from "../contracts/router.ts";
import type { BuildCheck, FactoryStatus } from "./channel.ts";
import type { FailedDelivery } from "./deliveries.ts";
import { deriveKey, hmacHex, timingSafeEqual } from "./keys.ts";

/** How long an operator's admin session lasts. */
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/** The latest build of a container's image, as the deployer last reported it. */
export type ContainerBuild = { state: BuildCheck["state"]; ref: string; url?: string; at: string };

/** A repo's last deploy, and the builds that it started. */
export type RepoDeploy = {
  repo: string;
  status: FactoryStatus;
  builds?: Record<string, ContainerBuild>;
};

/** Where the router keeps each repo's last deploy, so that an operator can list them without a call to the code host. */
export type DeployLog = {
  get(repo: string): Promise<RepoDeploy | undefined>;
  put(deploy: RepoDeploy): Promise<void>;
  remove(repo: string): Promise<void>;
  list(): Promise<RepoDeploy[]>;
};

/** `POST /admin/sign-in`: where the operator's browser comes back to, with a code. */
export type SignInRequest = { redirect: string; state: string };
export type SignInResult = { url: string };

/** `POST /admin/session`: the code that the sign-in page sent to `redirect`. */
export type SessionRequest = { code: string; redirect: string };
/** `operator` is who signed in, such as a GitHub login. `expires` is a time in milliseconds. */
export type SessionResult = { session: string; operator: string; expires: number };

/** `GET /admin/repos`: each repo's last deploy, and the containers that its outpost declares now. */
export type ReposResult = { repos: (RepoDeploy & { containers: string[] })[] };

/** `GET /admin/deliveries`. */
export type DeliveriesResult = { failed: FailedDelivery[] };

/** `POST /admin/replay`: one failed delivery, or all of them without `connection` and `id`. */
export type ReplayRequest = { connection?: string; id?: string };
export type ReplayResult = {
  replayed: { connection: string; id: string }[];
  /** The deliveries that the inbox no longer has as failed, such as one that another operator replayed. */
  skipped: { connection: string; id: string }[];
};

/** `POST /admin/sync`: the repos that the router started to deploy again, and those whose outposts it removes. */
export type SyncResult = { deploying: string[]; removing: string[] };

const encoder = new TextEncoder();

const base64url = (text: string) =>
  btoa(String.fromCharCode(...encoder.encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromBase64url = (text: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

const sessionKey = (rootKey: string) => deriveKey(rootKey, "operator:session");

type Session = { operator: string; expires: number };

/** A session token for `operator`: the session as base64url JSON, a dot, and its signature. */
export const signSession = async (rootKey: string, session: Session) => {
  const body = base64url(JSON.stringify(session));
  return `${body}.${await hmacHex(await sessionKey(rootKey), body)}`;
};

/** The session in `token`, if the router signed it and it hasn't expired. */
export const verifySession = async (rootKey: string, token: string, now = Date.now()): Promise<Session | undefined> => {
  const [body, signature, ...rest] = token.split(".");
  if (!body || !signature || rest.length) return undefined;
  if (!timingSafeEqual(signature, await hmacHex(await sessionKey(rootKey), body))) return undefined;
  try {
    const session = JSON.parse(fromBase64url(body)) as Session;
    if (typeof session.operator !== "string" || typeof session.expires !== "number" || session.expires <= now) return undefined;
    return session;
  } catch {
    return undefined;
  }
};

/** Whether the hub's operator auth lets `operator` in. GitHub logins are compared without case. */
export const isOperator = (operators: OperatorsEntry | undefined, operator: string) => {
  if (operators?.provider !== "github") return false;
  const logins = Array.isArray(operators.logins) ? (operators.logins as string[]) : [];
  return logins.some((login) => login.toLowerCase() === operator.toLowerCase());
};
