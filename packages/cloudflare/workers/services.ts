import { bindingName, isServiceName, SERVICE_HEADERS } from "@notation/factory/router";

/** Where services' hosts end: a container reaches the service `drafts` at `drafts.factory`. */
export const SERVICE_SUFFIX = ".factory";

export type Fetcher = { fetch(request: Request): Promise<Response> };

/** The router Worker's binding of the service `name`, such as `SERVICE_DRAFTS`. */
export const serviceBinding = (name: string) => `SERVICE_${bindingName(name)}`;

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

/** Forwards a request to `<name>.factory` to the binding `serviceBinding(name)`, as it is. */
export const forwardToService = async (request: Request, binding: (name: string) => Fetcher | undefined) => {
  const { hostname } = new URL(request.url);
  const name = hostname.endsWith(SERVICE_SUFFIX) ? hostname.slice(0, -SERVICE_SUFFIX.length) : "";
  const target = isServiceName(name) ? binding(serviceBinding(name)) : undefined;
  if (!target) return new Response(`The hub has no service at ${hostname}.`, { status: 404 });
  return target.fetch(request);
};
