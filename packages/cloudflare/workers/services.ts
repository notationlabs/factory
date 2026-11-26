import { type RouterConfig, SERVICE_HEADERS } from "@notation/factory/router";

/** Where services' hosts end: a container reaches the service `drafts` at `drafts.factory`. */
export const SERVICE_SUFFIX = ".factory";

/** The repo and the container that sent a request to a service. */
export type ServiceSender = { repo: string; container: string };

export type Fetcher = { fetch(request: Request): Promise<Response> };

/**
 * `request` with `SERVICE_HEADERS` set to `sender`. It drops every
 * `x-factory-*` header first, so a container can't name another sender.
 */
export const fromSender = (request: Request, sender: ServiceSender) => {
  const headers = new Headers(request.headers);
  for (const key of [...headers.keys()]) if (key.startsWith("x-factory-")) headers.delete(key);
  headers.set(SERVICE_HEADERS.repo, sender.repo);
  headers.set(SERVICE_HEADERS.container, sender.container);
  return new Request(request, { headers });
};

/**
 * Forwards a request to `<name>.factory` to the binding that the router's
 * config names for the service `name`, as it is.
 */
export const forwardToService = async (
  request: Request,
  services: RouterConfig["services"] | undefined,
  binding: (name: string) => Fetcher | undefined,
) => {
  const { hostname } = new URL(request.url);
  const name = hostname.endsWith(SERVICE_SUFFIX) ? hostname.slice(0, -SERVICE_SUFFIX.length) : undefined;
  const entry = name !== undefined && Object.hasOwn(services ?? {}, name) ? services![name] : undefined;
  const target = entry && binding(entry.binding);
  if (!target) return new Response(`The hub has no service at ${hostname}.`, { status: 404 });
  return target.fetch(request);
};
