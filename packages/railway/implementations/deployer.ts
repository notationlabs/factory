import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import {
  type Account,
  type Deployer as DeployerContract,
  secret,
} from "lightbox";
import { Service, type ServiceInstance } from "../resources/service.ts";
import type { Router } from "./router.ts";

export type DeployerOptions = ResourceOpts<
  {},
  { router: Router; accounts?: Account[] }
>;

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

  constructor({ id, dependencies }: DeployerOptions) {
    const { router, accounts = [] } = dependencies;
    super("railway/Deployer", { id, dependencies });
    this.router = router;
    this.accounts = accounts;

    router.vault.secret({
      id: `${id}-token`,
      name: "RAILWAY_API_TOKEN",
      value: secret.env("RAILWAY_API_TOKEN"),
    });

    for (const account of accounts) {
      for (const [env, value] of Object.entries(account.secrets)) {
        router.vault.secret({
          id: `${id}-${account.id}-${env}`,
          name: env,
          value,
        });
      }
    }

    this.service = this.add(
      new Service({
        id: `${id}-service`,
        config: {
          name: "lightbox-deployer",
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
  }
}
