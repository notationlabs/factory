import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import {
  type Account,
  type Deployer as DeployerContract,
  secret,
} from "factory";
import * as v from "valibot";
import { Worker, type WorkerInstance } from "../resources/worker.ts";
import type { Router } from "./router.ts";

const deployerConfig = v.object({
  /** Written to outposts' authorized_keys, for `container ssh` and `resume`. */
  knownHosts: v.optional(v.array(v.string()), []),
});
export type DeployerConfig = v.InferInput<typeof deployerConfig>;

export type DeployerOptions = ResourceOpts<
  DeployerConfig,
  { router: Router; accounts?: Account[] }
>;

/**
 * `new cloudflare.Deployer(...)`: a scale-to-zero Worker that builds outposts'
 * containers with Workers Builds. Its API token is pasted on the first deploy,
 * and it and the accounts' secrets go into the router's vault.
 */
export class Deployer
  extends ResourceGroup<DeployerConfig>
  implements DeployerContract
{
  readonly router: Router;
  readonly accounts: Account[];
  readonly worker: WorkerInstance;

  constructor({ id, config, dependencies }: DeployerOptions) {
    const { knownHosts } = v.parse(deployerConfig, config ?? {});
    const { router, accounts = [] } = dependencies;
    super("cloudflare/Deployer", { id, config });
    this.router = router;
    this.accounts = accounts;
    router.vault.secret({
      id: `${id}-token`,
      name: "DEPLOYER_API_TOKEN",
      value: secret.prompt("Cloudflare API token for Workers Builds"),
    });
    for (const account of accounts)
      for (const [env, value] of Object.entries(account.secrets))
        router.vault.secret({
          id: `${id}-${account.id}-${env}`,
          name: env,
          value,
        });
    this.worker = this.add(
      new Worker({
        id: `${id}-worker`,
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
