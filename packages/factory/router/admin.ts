import type { OperatorsEntry } from "../contracts/router.ts";
import type { BuildCheck, FactoryStatus, Operator } from "./channel.ts";
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
  /** Removes the repo's builds of containers other than `containers`. */
  pruneBuilds(repo: string, containers: string[]): Promise<void>;
  list(): Promise<RepoDeploy[]>;
  /** The repos that have a deploy, in lowercase, without reading their deploys. */
  repos(): Promise<string[]>;
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

const sessionKey = (rootKey: string) => deriveKey(rootKey, "operator:session");

type Session = Operator & { expires: number };

// encodeURIComponent leaves dots as they are.
const encodePart = (part: string) => encodeURIComponent(part).replaceAll(".", "%2E");

/**
 * A session token for an operator: `<login>.<id>.<expires>.<signature>`,
 * with the login and id URI-encoded so that neither can hold a dot. The
 * token carries both, so that each request can check them against the
 * operator auth again.
 */
export const signSession = async (rootKey: string, { login, id, expires }: Session) => {
  const body = `${encodePart(login)}.${encodePart(id)}.${expires}`;
  return `${body}.${await hmacHex(await sessionKey(rootKey), body)}`;
};

/** The session in `token`, if the router signed it and it hasn't expired. */
export const verifySession = async (rootKey: string, token: string, now = Date.now()): Promise<Session | undefined> => {
  const [login, id, expires, signature, ...rest] = token.split(".");
  if (!login || !id || !expires || !signature || rest.length) return undefined;
  if (!timingSafeEqual(signature, await hmacHex(await sessionKey(rootKey), `${login}.${id}.${expires}`))) return undefined;
  const session = { login: decodeURIComponent(login), id: decodeURIComponent(id), expires: Number(expires) };
  return session.expires > now ? session : undefined;
};

/**
 * Whether the hub's operator auth lets `operator` in. Each of `users` is a
 * GitHub login, compared without case, or a numeric account id.
 */
export const isOperator = (operators: OperatorsEntry | undefined, { login, id }: Operator) => {
  const users = operators?.users;
  return (
    Array.isArray(users) &&
    users.some((entry) =>
      typeof entry === "number" ? String(entry) === id : String(entry).toLowerCase() === login.toLowerCase(),
    )
  );
};
