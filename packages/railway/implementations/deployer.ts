import { ResourceGroup } from "@notation/resource";
import {
  type Account,
  type Deployer as DeployerContract,
  secret,
  type VaultItem,
} from "factory";
import { Service, type ServiceInstance } from "../resources/service.ts";
import type { Router } from "./router.ts";

export type DeployerOptions = { router: Router; accounts?: Account[] };

/**
 * `new railway.Deployer(...)`: a private, scale-to-zero service that builds
 * outposts as services in the hub's project. It manages them with your
 * `RAILWAY_API_TOKEN`, copied into the vault when it changes, as are the
 * accounts' secrets.
 */
export class Deployer
  extends ResourceGroup<{}, { router: Router; accounts?: Account[] }>
  implements DeployerContract
{
  readonly router: Router;
  readonly accounts: Account[];
  readonly service: ServiceInstance;

  constructor(id: string, { router, accounts = [] }: DeployerOptions) {
    super("railway/Deployer", id, {}, { router, accounts });
    this.router = router;
    this.accounts = accounts;

    this.service = this.add(
      new Service(`${id}-service`, {
        config: {
          name: "factory-deployer",
          sleep: true,
          vars: {
            ACCOUNTS: Object.fromEntries(
              accounts.map((a) => [a.runtime, Object.keys(a.secrets)]),
            ),
          },
        },
        dependencies: { project: router.project },
      }),
    );

    // It signs its calls to the router with a key derived from the root key.
    this.bindSecret(router.rootKey);
    router.vault.secret({
      id: `${id}-token`,
      name: "RAILWAY_API_TOKEN",
      value: secret.env("RAILWAY_API_TOKEN"),
      readers: [this],
    });

    for (const account of accounts) {
      for (const [env, value] of Object.entries(account.secrets)) {
        router.vault.secret({
          id: `${id}-${account.id}-${env}`,
          name: env,
          value,
          readers: [this],
        });
      }
    }
  }

  bindSecret(item: VaultItem): void {
    const { name } = item.config;
    this.service.contribute(
      { secrets: { [name]: name } },
      { by: `deployer ${this.id}` },
    );
    this.service.dependOn(item);
  }
}
