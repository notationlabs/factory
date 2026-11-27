import { isServiceName, SERVICE_HEADERS } from "@notation/factory/router";

/** Where services' hosts end: a container reaches the service `drafts` at `drafts.factory`. */
export const SERVICE_SUFFIX = ".factory";

export type Fetcher = { fetch(request: Request): Promise<Response> };

/** The router Worker's binding of the service `name`, such as `SERVICE_DRAFTS`. */
export const serviceBinding = (name: string) => `SERVICE_${name.toUpperCase().replaceAll("-", "_")}`;

/**
 * `request` with `SERVICE_HEADERS` set to the repo and container. It drops
 * every `x-factory-*` header first, so a container can't name another sender.
 */
export const fromSender = (request: Request, repo: string, container: string) => {
  const headers = new Headers(request.headers);
  for (const key of [...headers.keys()]) if (key.startsWith("x-factory-")) headers.delete(key);
  headers.set(SERVICE_HEADERS.repo, repo);
  headers.set(SERVICE_HEADERS.container, container);
  return new Request(request, { headers });
};

const isFetcher = (value: unknown): value is Fetcher =>
  typeof value === "object" && value !== null && typeof (value as Fetcher).fetch === "function";

/**
 * Forwards a request to `<name>.factory` to the binding `serviceBinding(name)`,
 * as it is. It answers 404 when the binding is missing or has no `fetch`.
 */
export const forwardToService = async (request: Request, binding: (name: string) => unknown) => {
  const { hostname } = new URL(request.url);
  const name = hostname.endsWith(SERVICE_SUFFIX) ? hostname.slice(0, -SERVICE_SUFFIX.length) : "";
  const target = isServiceName(name) ? binding(serviceBinding(name)) : undefined;
  if (!isFetcher(target)) return new Response(`The hub has no service at ${hostname}.`, { status: 404 });
  return target.fetch(request);
};
