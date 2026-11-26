import { ResourceGroup } from "@notation/resource";
import type { Service as ServiceContract } from "@notation/factory";
import type { Worker } from "@notation/cloudflare/workers";
import type { Router } from "./router.ts";

export type ServiceOptions = { router: Router; worker: Worker };

/**
 * `new cloudflare.Service(name, ...)`: a hub service that `worker` runs.
 * The router binds the Worker, and every container on the hub reaches it at
 * `http://<name>.factory`. The Worker gets each request with
 * `x-factory-repo` and `x-factory-container`, which the outpost sets.
 */
export class Service extends ResourceGroup implements ServiceContract {
  readonly name: string;

  constructor(name: string, { router, worker }: ServiceOptions) {
    super("cloudflare/Service", name);
    this.name = name;
    router.service(name, worker);
  }
}
