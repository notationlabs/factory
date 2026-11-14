import { ResourceGroup } from "@notation/resource";
import { type Account, type Deployer as DeployerContract } from "@notation/factory";
import {
  ProjectToken,
  type ProjectTokenInstance,
} from "../resources/project-token.ts";
import { Service, type ServiceInstance } from "../resources/service.ts";
import type { Router } from "./router.ts";
import { bindSecret } from "./bind-secrets.ts";
import type { Vault } from "./vault.ts";

export type DeployerOptions = {
  router: Router;
  vault: Vault;
  accounts?: Account[];
};

/**
 * `new railway.Deployer(...)`: a private, scale-to-zero service that builds
 * outposts as services in the hub's project. It manages them with a project
 * token of its own. It binds the root key and the accounts' secrets.
 */
export class Deployer extends ResourceGroup implements DeployerContract {
  readonly router: Router;
  readonly vault: Vault;
  readonly accounts: Account[];
  readonly token: ProjectTokenInstance;
  readonly service: ServiceInstance;

  constructor(id: string, { router, vault, accounts = [] }: DeployerOptions) {
    super("railway/Deployer", id, {});
    this.router = router;
    this.vault = vault;
    this.accounts = accounts;

    this.token = this.add(
      new ProjectToken(`${id}-token`, {
        config: { name: "factory-deployer" },
        dependencies: { project: router.project },
      }),
    );

    this.service = this.add(
      new Service(`${id}-service`, {
        config: {
          name: "factory-deployer",
          sleep: true,
          vars: {
            ACCOUNTS: JSON.stringify(
              Object.fromEntries(
                accounts.map((a) => [a.runtime, Object.keys(a.secrets)]),
              ),
            ),
          },
        },
        dependencies: { project: router.project },
      }),
    );
    bindSecret(this.service, "FACTORY_ROOT_KEY", router.rootKey);
    for (const account of accounts) {
      for (const [name, secret] of Object.entries(account.secrets)) {
        bindSecret(this.service, name, secret);
      }
    }
  }
}
