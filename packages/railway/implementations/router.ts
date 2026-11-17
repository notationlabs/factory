import { type OutputRef, ResourceGroup } from "@notation/resource";
import {
  bindingName,
  RandomKey,
  type RandomKeyInstance,
  type Router as RouterContract,
  type RouterChannelOptions,
  type VaultSecret,
} from "@notation/factory";
import * as v from "valibot";
import { Project, type ProjectInstance } from "../resources/project.ts";
import {
  RouterConfig,
  type RouterConfigInstance,
} from "../resources/router-config.ts";
import { Service, type ServiceInstance } from "../resources/service.ts";
import { bindSecret } from "./bind-secrets.ts";
import type { RailwaySecret, Vault } from "./vault.ts";

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
  extends ResourceGroup<RouterGroupConfig>
  implements RouterContract
{
  readonly vault: Vault;
  readonly project: ProjectInstance;
  readonly rootKeyValue: RandomKeyInstance;
  readonly rootKey: RailwaySecret;
  readonly service: ServiceInstance;
  readonly url: OutputRef<string>;
  readonly store: RouterConfigInstance;

  constructor(id: string, { vault, ...config }: RouterOptions) {
    const { project } = v.parse(routerConfig, config);
    super("railway/Router", id, config);
    this.vault = vault;
    this.project = this.add(
      new Project(`${id}-project`, { config: { name: project } }),
    );
    this.vault.bind(this.project);
    this.rootKeyValue = this.add(
      new RandomKey(`${id}-root-key`, { config: { Bytes: 32 } }),
    );
    this.rootKey = this.vault.secret({
      id: `${id}-root-key`,
      value: this.rootKeyValue.credentials.Value,
    });
    this.service = this.add(
      new Service(`${id}-service`, {
        config: { name: "factory-router", public: true, volume: "/data" },
        dependencies: { project: this.project },
      }),
    );
    this.url = this.service.outputRef("Url");
    this.bind(this.rootKey, "FACTORY_ROOT_KEY");
    this.store = this.add(
      new RouterConfig(`${id}-config`, {
        config: { path: "/data/config.json" },
        dependencies: { service: this.service },
      }),
    );
  }

  bind(secret: VaultSecret, name = bindingName(secret.id)): string {
    bindSecret(this.service, name, secret);
    return name;
  }

  channel({ connection }: RouterChannelOptions): void {
    throw new Error(
      `The Railway router ${this.id} can't run the channel of ${connection} yet: its service has no router code.`,
    );
  }
}
