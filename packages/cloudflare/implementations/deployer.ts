import { ResourceGroup } from "@notation/resource";
import {
  type Account,
  type Deployer as DeployerContract,
} from "@notation/factory";
import { tokens } from "@notation/cloudflare/resources";
import {
  $durableObject,
  addBindings,
  json,
  type Worker,
  worker,
  workerLoader,
} from "@notation/cloudflare/workers";
import * as v from "valibot";
import { DEPLOYER_BINDING, KV_BINDING, R2_BINDING } from "./bindings.ts";
import { COMPATIBILITY_DATE, workerBundle } from "./code.ts";
import { outpostImage } from "./image.ts";
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
  /** The most outpost containers that can run at once, across all repos. */
  maxContainers: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 10),
});
export type DeployerConfig = v.InferInput<typeof deployerConfig>;

export type DeployerOptions = DeployerConfig & {
  router: Router;
  vault: Vault;
  accounts?: Account[];
};

// Notation finds a Durable Object's class by its name, which the deployer
// Worker's bundle exports. The class itself only runs in the Worker.
const OutpostContainer = class OutpostContainer {};

/**
 * `new cloudflare.Deployer(...)`: a Worker that evaluates outposts' configs,
 * and hosts their containers as Durable Objects with an API token of its
 * own. It binds the root key and the accounts' secrets. Every outpost
 * container runs one image, which deploy builds with local Docker: it has
 * the accounts' runtimes and the runner.
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
    const {
      knownHosts,
      maxContainers,
      accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
    } = v.parse(deployerConfig, config);
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

    const runtimes = [
      ...new Map(accounts.map((a) => [a.runtime.id, a.runtime])).values(),
    ];
    const outposts = $durableObject({
      id: `${id}-outposts`,
      class: OutpostContainer,
      container: {
        image: { context: outpostImage(id, runtimes) },
        maxInstances: maxContainers,
        instanceType: "standard-1",
      },
    });

    this.worker = worker({
      id,
      compatibilityDate: COMPATIBILITY_DATE,
      // Cloudflare refuses a Worker's fetch of another workers.dev URL on the
      // same account without it, and containers reply through the router's.
      compatibilityFlags: ["global_fetch_strictly_public"],
      code: workerBundle(`${id}-deployer`, "deployer"),
      url: false,
      bindings: () => ({
        OUTPOSTS: outposts,
        [KV_BINDING]: router.kv,
        // Keeps outposts' worktrees and sessions while their containers sleep.
        [R2_BINDING]: router.bucket,
        // Runs outposts' configs, each in an isolate with no network.
        LOADER: workerLoader(),
        CLOUDFLARE_API_TOKEN: this.tokenSecret.secret,
        FACTORY_ROOT_KEY: router.rootKey.secret,
        CLOUDFLARE_ACCOUNT_ID: json(accountId),
        KNOWN_HOSTS: json(knownHosts),
        ACCOUNTS: json(
          Object.fromEntries(
            accounts.map((a) => [a.runtime.id, Object.keys(a.secrets)]),
          ),
        ),
      }),
    });
    // The router hands the deployer the repos that a push or an install changed.
    addBindings(router.worker, { [DEPLOYER_BINDING]: this.worker });
    for (const account of accounts) {
      for (const [name, secret] of Object.entries(account.secrets)) {
        assertCloudflareSecret(secret);
        addBindings(this.worker, { [name]: secret.secret });
      }
    }
  }
}
