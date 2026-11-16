import { ResourceGroup } from "@notation/resource";
import {
  type Account,
  type Deployer as DeployerContract,
} from "@notation/factory";
import { tokens, workers } from "@notation/cloudflare/resources";
import type { fs } from "@notation/std/resources";
import * as v from "valibot";
import { kvBinding, secretBinding, jsonBindings } from "./bindings.ts";
import { COMPATIBILITY_DATE, workerCode } from "./code.ts";
import type { Router } from "./router.ts";
import {
  assertCloudflareSecret,
  type CloudflareSecret,
  type Vault,
} from "./vault.ts";

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
 * with Workers Builds, with an API token of its own. It binds the root key
 * and the accounts' secrets.
 */
export class Deployer
  extends ResourceGroup<DeployerConfig>
  implements DeployerContract
{
  readonly router: Router;
  readonly vault: Vault;
  readonly accounts: Account[];
  readonly token: tokens.AccountTokenInstance;
  /** Holds the token's value. */
  readonly tokenSecret: CloudflareSecret;
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

    this.token = this.add(
      new tokens.AccountToken(`token:${id}-token`, {
        config: {
          Policies: [
            {
              effect: "allow",
              permissionGroups: [
                "Workers Scripts Write",
                "Workers CI Write",
                "Workers Containers Write",
              ],
              resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
            },
          ],
        },
      }),
    );
    this.tokenSecret = vault.secret({
      id: `${id}-token`,
      value: this.token.credentials.Value,
    });

    const accountSecrets = accounts.flatMap((account) =>
      Object.entries(account.secrets).map(([name, secret]) => {
        assertCloudflareSecret(secret);
        return secretBinding(name, secret);
      }),
    );

    this.code = this.add(workerCode(`${id}-worker`, "deployer"));
    this.script = this.add(
      new workers.WorkerScript(`${id}-worker`, {
        config: {
          CompatibilityDate: COMPATIBILITY_DATE,
          Bindings: [
            kvBinding(router.kv),
            secretBinding("CLOUDFLARE_API_TOKEN", this.tokenSecret),
            secretBinding("FACTORY_ROOT_KEY", router.rootKey),
            ...accountSecrets,
            ...jsonBindings({
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
  }
}
