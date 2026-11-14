import { ResourceGroup } from "@notation/resource";
import {
  type Account,
  type Deployer as DeployerContract,
} from "@notation/factory";
import { workers } from "@notation/cloudflare/resources";
import {
  type AccountTokenGroup,
  accountToken,
} from "@notation/cloudflare/tokens";
import type { fs } from "@notation/std/resources";
import * as v from "valibot";
import {
  bindVaultSecrets,
  kvBinding,
  secretBinding,
  varBindings,
} from "./bindings.ts";
import { COMPATIBILITY_DATE, workerCode } from "./code.ts";
import type { Router } from "./router.ts";
import type { Vault } from "./vault.ts";

const deployerConfig = v.object({
  /** Written to outposts' authorized_keys, for `container ssh` and `resume`. */
  knownHosts: v.optional(v.array(v.string()), []),
  /**
   * The Cloudflare account that the deployer's API token may act in.
   * Defaults to `CLOUDFLARE_ACCOUNT_ID`.
   */
  accountId: v.optional(v.string()),
});
export type DeployerConfig = v.InferInput<typeof deployerConfig>;

export type DeployerOptions = DeployerConfig & {
  router: Router;
  vault: Vault;
  accounts?: Account[];
};

/**
 * `new cloudflare.Deployer(...)`: a Worker that builds outposts' containers
 * with Workers Builds, with an API token of its own. The accounts' secrets
 * go into the vault, bound to the deployer only.
 */
export class Deployer
  extends ResourceGroup<DeployerConfig>
  implements DeployerContract
{
  readonly router: Router;
  readonly vault: Vault;
  readonly accounts: Account[];
  readonly token: AccountTokenGroup;
  readonly code: fs.FileInstance;
  readonly script: workers.WorkerScriptInstance;

  constructor(
    id: string,
    { router, vault, accounts = [], ...config }: DeployerOptions,
  ) {
    const { knownHosts, accountId = process.env.CLOUDFLARE_ACCOUNT_ID } =
      v.parse(deployerConfig, config);
    if (!accountId) {
      throw new Error(
        `The deployer ${id} needs the Cloudflare account that its API token may act in. Set CLOUDFLARE_ACCOUNT_ID, or pass accountId.`,
      );
    }
    super("cloudflare/Deployer", id, config);
    this.router = router;
    this.vault = vault;
    this.accounts = accounts;

    this.token = accountToken({
      id: `${id}-token`,
      policies: [
        {
          effect: "allow",
          permissionGroups: [
            "Workers Scripts Write",
            "Workers CI Write",
            "Containers Write",
          ],
          resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
        },
      ],
    });

    for (const account of accounts) {
      for (const [env, from] of Object.entries(account.secrets)) {
        vault.secret({
          id: `${id}-${account.id}-${env}`,
          binding: env,
          consumers: ["deployer"],
          ...from,
        });
      }
    }

    this.code = this.add(workerCode(`${id}-worker`, "deployer"));
    this.script = this.add(
      new workers.WorkerScript(`${id}-worker`, {
        config: {
          CompatibilityDate: COMPATIBILITY_DATE,
          Bindings: [
            kvBinding(router.kv),
            secretBinding("CLOUDFLARE_API_TOKEN", this.token),
            ...varBindings({
              CLOUDFLARE_ACCOUNT_ID: accountId,
              KNOWN_HOSTS: knownHosts,
              ACCOUNTS: Object.fromEntries(
                accounts.map((a) => [a.runtime, Object.keys(a.secrets)]),
              ),
            }),
          ],
        },
        dependencies: { code: this.code },
      }),
    );
    bindVaultSecrets(this.script, vault, "deployer");
  }
}
