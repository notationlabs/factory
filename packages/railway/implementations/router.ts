import { ResourceGroup } from "@notation/resource";
import { type Router as RouterContract, secret } from "lightbox";
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

export type RouterOptions = RouterGroupConfig & { vault: Vault };

/**
 * `new railway.Router(...)`: the hub's Railway project, a public router
 * service with a `/data` volume and the webhook's domain, and the config
 * file on that volume. Creating it binds the vault to the project and
 * generates the root key into it.
 */
export class Router
  extends ResourceGroup<RouterGroupConfig, { vault: Vault }>
  implements RouterContract
{
  readonly vault: Vault;
  readonly project: ProjectInstance;
  readonly api: ServiceInstance;
  readonly store: RouterConfigInstance;

  constructor(id: string, { vault, ...config }: RouterOptions) {
    const { project } = v.parse(routerConfig, config);
    super("railway/Router", id, config, { vault });
    this.vault = vault;
    this.project = this.add(
      new Project(`${id}-project`, { config: { name: project } }),
    );
    this.vault.bind(this.project);
    this.vault.secret({
      id: `${id}-root-key`,
      name: "LIGHTBOX_ROOT_KEY",
      value: secret.generated(),
    });
    this.api = this.add(
      new Service(`${id}-service`, {
        config: { name: "lightbox-router", public: true, volume: "/data" },
        dependencies: { project: this.project },
      }),
    );
    this.store = this.add(
      new RouterConfig(`${id}-config`, {
        config: { path: "/data/config.json" },
        dependencies: { service: this.api },
      }),
    );
  }
}
