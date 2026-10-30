import { ResourceGroup } from "@notation/resource";
import { type Account, type Deployer as DeployerContract } from "factory";
import * as v from "valibot";
import { ApiToken, type ApiTokenInstance } from "../resources/api-token.ts";
import { Worker, type WorkerInstance } from "../resources/worker.ts";
import type { Router } from "./router.ts";

const deployerConfig = v.object({
  /** Written to outposts' authorized_keys, for `container ssh` and `resume`. */
  knownHosts: v.optional(v.array(v.string()), []),
});
export type DeployerConfig = v.InferInput<typeof deployerConfig>;

export type DeployerOptions = DeployerConfig & {
  router: Router;
  accounts?: Account[];
};

/**
 * `new cloudflare.Deployer(...)`: a scale-to-zero Worker that builds outposts'
 * containers with Workers Builds, with an API token of its own. The accounts'
 * secrets go into the router's vault.
 */
export class Deployer
  extends ResourceGroup<DeployerConfig>
  implements DeployerContract
{
  readonly router: Router;
  readonly accounts: Account[];
  readonly token: ApiTokenInstance;
  readonly worker: WorkerInstance;

  constructor(
    id: string,
    { router, accounts = [], ...config }: DeployerOptions,
  ) {
    const { knownHosts } = v.parse(deployerConfig, config);
    super("cloudflare/Deployer", id, config);
    this.router = router;
    this.accounts = accounts;

    this.token = this.add(
      new ApiToken(`${id}-token`, {
        config: {
          name: `${router.project}-deployer`,
          permissions: [
            "Workers Scripts Write",
            "Workers Builds Configuration Edit",
          ],
        },
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

    this.worker = this.add(
      new Worker(`${id}-worker`, {
        config: {
          ScriptName: `${router.project}-deployer`,
          IdleTimeout: "10m",
          Vars: {
            KNOWN_HOSTS: knownHosts,
            ACCOUNTS: Object.fromEntries(
              accounts.map((a) => [a.runtime, Object.keys(a.secrets)]),
            ),
          },
        },
        dependencies: { kv: router.kv, store: router.vault.store },
      }),
    );
  }
}
