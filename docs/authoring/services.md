# Services

A service is a Worker that the hub runs for its containers. Every container on the hub reaches each service at `http://<name>.factory`, with no credential. The service gets each request with two headers that name the repo and the container that sent it. The hub sets these headers, and the container can't.

Factory ships no services, so each hub declares its own. This page uses a service named `drafts` as its example. Agents upload web pages to `drafts`, and the service stores them in an R2 bucket.

## Declaring a service

The hub declares the service's Worker with Notation, and passes it to `cloudflare.Service` with the router:

```ts [factory.infra.ts]
import { bundle } from "@notation/build/resources";
import { r2 } from "@notation/cloudflare/resources";
import { worker } from "@notation/cloudflare/workers";
import * as cloudflare from "@notation/factory-cloudflare";

const bucket = new r2.R2Bucket("drafts", { config: { BucketName: "drafts" } });
const drafts = worker({
  id: "drafts",
  compatibilityDate: "2026-10-12",
  code: bundle({ id: "drafts", platform: "workerd", entry: "./workers/drafts.ts" }),
  bindings: () => ({ BUCKET: bucket }),
  url: false, // <-- no public URL
});

new cloudflare.Service("drafts", { router, worker: drafts });
```

The service's id is its name, and containers reach it at `drafts.factory`. `cloudflare.Service` does two things:

1. It binds the Worker to the router Worker as `SERVICE_DRAFTS`.
2. It adds `drafts: { binding: "SERVICE_DRAFTS" }` to `services` in the router's config.

Outposts don't declare services, and containers don't list them. Every container on the hub can reach every service.

A service's name must be a lowercase DNS label: letters, digits and hyphens, at most 63 characters, and not starting or ending with a hyphen. It can't be `state` or `runner`, since the outpost already serves `state.factory` and `runner.factory`. `isServiceName` in `@notation/factory` checks a name. `cloudflare.Service` throws on a name that fails the check, and on a second service with the same name.

## Writing the service's Worker

The service's Worker is a plain fetch handler. It reads the sender from the headers in `SERVICE_HEADERS`:

```ts [workers/drafts.ts]
import { SERVICE_HEADERS } from "@notation/factory/router";

export default {
  async fetch(request: Request, env: { BUCKET: R2Bucket }) {
    const repo = request.headers.get(SERVICE_HEADERS.repo); // <-- such as "acme/app"
    const container = request.headers.get(SERVICE_HEADERS.container); // <-- such as "dev"
    if (!repo || !container) return new Response("bad request", { status: 400 });
    const key = new URL(request.url).pathname.slice(1);
    await env.BUCKET.put(key, request.body, {
      httpMetadata: { contentType: request.headers.get("content-type") ?? undefined },
      customMetadata: { repo, container },
    });
    return new Response(null, { status: 204 });
  },
};
```

The Worker gets the request at the URL that the container used, so a container's `PUT http://drafts.factory/a1b2/index.html` arrives with the pathname `/a1b2/index.html`.

`SERVICE_HEADERS.repo` is `x-factory-repo`, and `SERVICE_HEADERS.container` is `x-factory-container`. **These headers are the only proof of who sent a request.** A service that keeps data per repo, or limits what a repo may do, should read them on every request.

The headers can be trusted only if nothing else can reach the Worker. For this reason, the `drafts` Worker sets `url: false`, so it has no workers.dev URL, and only Workers that bind it, such as the router, reach it. A service that also serves the public, such as one that publishes the drafts, should do so from a second Worker with a URL.

## Calling the service from a container

A script or an agent in the container calls the service by its host:

```js [.factory/bin/publish-draft]
await fetch(`http://drafts.factory/${prefix}/index.html`, {
  method: "PUT",
  headers: { "content-type": "text/html" },
  body,
});
```

The URL must use `http`. The outpost intercepts the container's plain HTTP requests only, and `drafts.factory` has no DNS record, so an `https` request to it fails.

## How a request reaches the service

A request from a container passes through the outpost Worker and the router before it reaches the service:

```mermaid [A request to drafts.factory]
flowchart LR
  C["Container"] -->|"PUT http://drafts.factory/..."| O["Outpost Worker"]
  O -->|"ROUTER binding"| R["Router's ServiceGateway"]
  R -->|"SERVICE_DRAFTS binding"| S["drafts Worker"]
```

The steps are:

1. The router puts the names in its config's `services` into each run that it sends, as `services: ["drafts"]`.
2. Before the outpost Worker starts the container for a run, it registers `drafts.factory` with `setOutboundByHosts` from `@cloudflare/containers`. It passes the run's repo and container as the handler's params.
3. When the container sends a request to `drafts.factory`, the outpost Worker's handler gets it. The handler drops every header whose name starts with `x-factory-`, and sets `x-factory-repo` and `x-factory-container` from its params.
4. The handler forwards the request over the outpost Worker's `ROUTER` binding, which reaches the router Worker's `ServiceGateway` entrypoint. Only a binding reaches that entrypoint. The router's public URL doesn't.
5. The router reads `services.drafts.binding` from its config, and forwards the request over `SERVICE_DRAFTS` without changes. A host that names no service gets a 404.

## When containers see a change

The outpost registers the hosts again for each run, so changes reach a container at its next run:

- After `factory infra up` adds a service, a container reaches it from its next run on.
- After `factory infra up` removes a service, the next run no longer registers its host. The container's requests to the host then go to the internet, where the host doesn't resolve.

The container's Durable Object keeps the hosts in its storage, and `@cloudflare/containers` registers them again each time the container starts. So a container that sleeps and wakes, or restarts, keeps the last run's hosts.

Outpost Workers built before a hub had services don't bind the router. Their Workers' config changes with this binding, so the next deploy of each repo rebuilds them. `factory infra up` deploys every repo at the end of each deploy.

## Other plain HTTP traffic

Once the outpost registers a host at runtime, `@cloudflare/containers` 0.3.7 intercepts all of the container's plain HTTP requests, and keeps doing so after the container restarts. The outpost Worker fetches the requests to other hosts itself. The container's HTTPS requests don't pass through the outpost Worker. This applies only to hubs that have at least one service, since a run with no services registers no hosts.

## Services on other providers

The `Service` contract in `packages/factory/contracts/hub.ts` has only `name`. A provider decides how a service runs, and must do the following:

- Record each service in `services` in the router's config, so that the router puts its name in each run's `services`.
- Make `<name>.factory` reach the service from each container, with `SERVICE_HEADERS` set from the run's `repo` and `container`.
- Drop every `x-factory-*` header that the container sent.

Only the Cloudflare provider has services. `@notation/factory-railway` doesn't have them yet.
