import type { OperatorsEntry } from "../contracts/router.ts";
import type { BuildCheck, FactoryStatus } from "./channel.ts";
import type { FailedDelivery } from "./deliveries.ts";
import { deriveKey, hmacHex, timingSafeEqual } from "./keys.ts";

/** How long an operator's admin session lasts. */
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/** The latest build of a container's image, as the deployer last reported it. */
export type ContainerBuild = { state: BuildCheck["state"]; ref: string; url?: string; summary?: string; at: string };

/** A repo's last deploy, and the latest build of each of its containers. */
export type RepoDeploy = {
  repo: string;
  status: FactoryStatus;
  builds: Record<string, ContainerBuild>;
};

/**
 * Where the router keeps each repo's last deploy, and each container's latest
 * build, so that an operator can list them without a call to the code host.
 * Each build is kept on its own, so that reports of different builds don't
 * overwrite each other.
 */
export type DeployLog = {
  put(repo: string, status: FactoryStatus): Promise<void>;
  /** Removes the repo's deploy and its builds. */
  remove(repo: string): Promise<void>;
  build(repo: string, container: string): Promise<ContainerBuild | undefined>;
  putBuild(repo: string, container: string, build: ContainerBuild): Promise<void>;
  list(): Promise<RepoDeploy[]>;
};

/** `POST /admin/sign-in`: `state` comes back to the operator's browser with the code. */
export type SignInRequest = { state: string };
export type SignInResult = { url: string };

/** `POST /admin/session`: the code that the sign-in page sent to the operator's browser. */
export type SessionRequest = { code: string };
/** `operator` is who signed in, such as a GitHub login. `expires` is a time in milliseconds. */
export type SessionResult = { session: string; operator: string; expires: number };

/** `GET /admin/repos`. */
export type ReposResult = { repos: RepoDeploy[] };

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

const sessionKey = (rootKey: string) => deriveKey(rootKey, "operator:session");

type Session = { operator: string; expires: number };

/** A session token for `operator`: `<operator>.<expires>.<signature>`. A GitHub login has no dot. */
export const signSession = async (rootKey: string, { operator, expires }: Session) => {
  const body = `${operator}.${expires}`;
  return `${body}.${await hmacHex(await sessionKey(rootKey), body)}`;
};

/** The session in `token`, if the router signed it and it hasn't expired. */
export const verifySession = async (rootKey: string, token: string, now = Date.now()): Promise<Session | undefined> => {
  const [operator, expires, signature, ...rest] = token.split(".");
  if (!operator || !expires || !signature || rest.length) return undefined;
  if (!timingSafeEqual(signature, await hmacHex(await sessionKey(rootKey), `${operator}.${expires}`))) return undefined;
  const session = { operator, expires: Number(expires) };
  return session.expires > now ? session : undefined;
};

/** Whether the hub's operator auth lets `operator` in. GitHub logins are compared without case. */
export const isOperator = (operators: OperatorsEntry | undefined, operator: string) => {
  const logins = operators?.logins;
  return Array.isArray(logins) && logins.some((login) => String(login).toLowerCase() === operator.toLowerCase());
};
