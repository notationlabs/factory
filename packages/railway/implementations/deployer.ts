import { ResourceGroup } from "@notation/resource";
import { type Account, type Deployer as DeployerContract } from "lightbox";
import {
  ProjectToken,
  type ProjectTokenInstance,
} from "../resources/project-token.ts";
import { Service, type ServiceInstance } from "../resources/service.ts";
import type { Router } from "./router.ts";

export type DeployerOptions = { router: Router; accounts?: Account[] };

/**
 * `new railway.Deployer(...)`: a private, scale-to-zero service that builds
 * outposts as services in the hub's project. It manages them with a project
 * token of its own. The accounts' secrets go into the router's vault.
 */
export class Deployer extends ResourceGroup implements DeployerContract {
  readonly router: Router;
  readonly accounts: Account[];
  readonly token: ProjectTokenInstance;
  readonly service: ServiceInstance;

  constructor(id: string, { router, accounts = [] }: DeployerOptions) {
    super("railway/Deployer", id, {});
    this.router = router;
    this.accounts = accounts;

    this.token = this.add(
      new ProjectToken(`${id}-token`, {
        config: { name: "lightbox-deployer" },
        dependencies: { project: router.project },
      }),
    );

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
      new Service(`${id}-service`, {
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
