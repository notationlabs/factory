import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import { type Router as RouterContract, secret } from "factory";
import * as v from "valibot";
import { Project, type ProjectInstance } from "../resources/project.ts";
import {
  RouterConfig,
  type RouterConfigInstance,
} from "../resources/router-config.ts";
import { Service, type ServiceInstance } from "../resources/service.ts";
import type { Vault } from "./vault.ts";

const routerConfig = v.object({ project: v.string() });
export type RouterGroupConfig = v.InferInput<typeof routerConfig>;

export type RouterOptions = ResourceOpts<RouterGroupConfig, { vault: Vault }>;

/**
 * `new railway.Router(...)`: the hub's Railway project, a public router
 * service with a `/data` volume and the webhook's domain, and the config
 * file on that volume. Creating it binds the vault to the project and
 * generates the root key into it.
 */
export class Router
  extends ResourceGroup<RouterGroupConfig>
  implements RouterContract
{
  readonly vault: Vault;
  readonly project: ProjectInstance;
  readonly api: ServiceInstance;
  readonly store: RouterConfigInstance;

  constructor({ id, config, dependencies }: RouterOptions) {
    const { project } = v.parse(routerConfig, config);
    super("railway/Router", {
      config,
      dependencies: { vault: dependencies.vault.id },
    });
    this.vault = dependencies.vault;
    this.project = this.add(
      new Project({ id: `${id}-project`, config: { name: project } }),
    );
    this.vault.bind(this.project);
    this.vault.secret({
      id: `${id}-root-key`,
      name: "FACTORY_ROOT_KEY",
      value: secret.generated(),
    });
    this.api = this.add(
      new Service({
        id: `${id}-service`,
        config: { name: "factory-router", public: true, volume: "/data" },
        dependencies: { project: this.project },
      }),
    );
    this.store = this.add(
      new RouterConfig({
        id: `${id}-config`,
        config: { path: "/data/config.json" },
        dependencies: { service: this.api },
      }),
    );
  }
}
