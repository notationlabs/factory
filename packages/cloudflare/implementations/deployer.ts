import { ResourceGroup } from "@notation/resource";
import {
  type Account,
  type Deployer as DeployerContract,
} from "@notation/factory";
import { tokens } from "@notation/cloudflare/resources";
import {
  addBindings,
  json,
  type Worker,
  worker,
} from "@notation/cloudflare/workers";
import * as v from "valibot";
import { KV_BINDING } from "./bindings.ts";
import { COMPATIBILITY_DATE, workerBundle } from "./code.ts";
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
  readonly worker: Worker;

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

    this.worker = worker({
      id,
      compatibilityDate: COMPATIBILITY_DATE,
      code: workerBundle(`${id}-deployer`, "deployer"),
      url: false,
      bindings: () => ({
        [KV_BINDING]: router.kv,
        CLOUDFLARE_API_TOKEN: this.tokenSecret.secret,
        FACTORY_ROOT_KEY: router.rootKey.secret,
        CLOUDFLARE_ACCOUNT_ID: json(accountId),
        KNOWN_HOSTS: json(knownHosts),
        ACCOUNTS: json(
          Object.fromEntries(
            accounts.map((a) => [a.runtime, Object.keys(a.secrets)]),
          ),
        ),
      }),
    });
    for (const account of accounts) {
      for (const [name, secret] of Object.entries(account.secrets)) {
        assertCloudflareSecret(secret);
        addBindings(this.worker, { [name]: secret.secret });
      }
    }
  }
}
