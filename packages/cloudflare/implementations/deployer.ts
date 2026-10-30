import { ResourceGroup } from "@notation/resource";
import {
  type Account,
  type Deployer as DeployerContract,
  secret,
  type VaultItem,
} from "factory";
import * as v from "valibot";
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
 * containers with Workers Builds. Its API token is pasted on the first deploy,
 * and it and the accounts' secrets go into the router's vault.
 */
export class Deployer
  extends ResourceGroup<
    DeployerConfig,
    { router: Router; accounts?: Account[] }
  >
  implements DeployerContract
{
  readonly router: Router;
  readonly accounts: Account[];
  readonly worker: WorkerInstance;

  constructor(
    id: string,
    { router, accounts = [], ...config }: DeployerOptions,
  ) {
    const { knownHosts } = v.parse(deployerConfig, config);
    super("cloudflare/Deployer", id, config, { router, accounts });
    this.router = router;
    this.accounts = accounts;

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

    // It signs its calls to the router with a key derived from the root key.
    this.bindSecret(router.rootKey);
    router.vault.secret({
      id: `${id}-token`,
      name: "DEPLOYER_API_TOKEN",
      value: secret.prompt("Cloudflare API token for Workers Builds"),
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
    this.worker.contribute(
      { Secrets: { [name]: name } },
      { by: `deployer ${this.id}` },
    );
    this.worker.dependOn(item);
  }
}
