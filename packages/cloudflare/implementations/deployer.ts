import { readFileSync } from "node:fs";
import { ResourceGroup } from "@notation/resource";
import {
  type Account,
  type Deployer as DeployerContract,
  scopedName,
} from "@notation/factory";
import { kvJson } from "@notation/cloudflare/kv";
import { tokens } from "@notation/cloudflare/resources";
import {
  addBindings,
  isWorkerGroup,
  json,
  type Worker,
  worker,
  workerLoader,
} from "@notation/cloudflare/workers";
import * as v from "valibot";
import { DEPLOYER_BINDING, KV_BINDING, R2_BINDING } from "./bindings.ts";
import { COMPATIBILITY_DATE, workerBundle } from "./code.ts";
import { ArtifactsNamespace, type ArtifactsNamespaceInstance } from "../resources/artifacts.ts";
import { BuildsToken, type BuildsTokenInstance } from "../resources/builds-token.ts";
import { OutpostSettingsSchema } from "../workers/outpost-settings.ts";
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
  /**
   * The regions where outpost containers may run, such as `["WEUR"]`.
   * Without it, Cloudflare starts a container in the location nearest to
   * the request that has the image, which can be far from the repo's users.
   */
  regions: v.optional(
    v.array(v.picklist(["ENAM", "WNAM", "EEUR", "WEUR", "APAC", "SAM", "ME", "OC", "AFR"])),
  ),
  /**
   * How long an outpost container stays up with no run in progress, such as
   * `"30s"`, `"10m"` or `"1h"`. A shorter time costs less, and makes more
   * runs wait for a cold start.
   */
  sleepAfter: v.optional(
    v.pipe(
      v.string(),
      v.regex(/^[1-9]\d*[smh]$/, 'sleepAfter is a number of seconds, minutes or hours, such as "30s", "10m" or "1h".'),
    ),
    "10m",
  ),
});
export type DeployerConfig = v.InferInput<typeof deployerConfig>;

export type DeployerOptions = DeployerConfig & {
  router: Router;
  vault: Vault;
  accounts?: Account[];
};

/** A module whose default export is Factory's default outpost Dockerfile. */
const dockerfileModule = () =>
  `export default ${JSON.stringify(readFileSync(new URL("../image/Dockerfile", import.meta.url), "utf8"))};`;

/** Leaves room in an outpost Worker's name for `-` and a 12-character hash, within a DNS label. */
const OUTPOST_PREFIX_MAX_LENGTH = 50;

/**
 * `new cloudflare.Deployer(...)`: a Worker that evaluates outposts' configs.
 * For each repo's container, it commits the container's source to an
 * Artifacts repo, and Workers Builds builds the image and deploys an outpost
 * Worker that hosts the container. It builds with a user API token, which
 * deploy asks you for once. It binds the root key and the accounts' secrets.
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
  /** Holds each outpost Worker's source. */
  readonly namespace: ArtifactsNamespaceInstance;
  /** The user API token that the deployer builds outpost Workers with. */
  readonly buildsToken: BuildsTokenInstance;
  /** Holds the builds token's value. */
  readonly buildsTokenSecret: CloudflareSecret;
  readonly worker: Worker;

  constructor(
    id: string,
    { router, vault, accounts = [], ...config }: DeployerOptions,
  ) {
    const {
      knownHosts,
      regions,
      sleepAfter,
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

    this.namespace = this.add(
      new ArtifactsNamespace(`artifacts:${id}-outposts`, { config: { AccountId: accountId } }),
    );
    this.buildsToken = this.add(
      new BuildsToken(`token:${id}-builds`, { config: { AccountId: accountId, Name: scopedName(`${id}-builds`, 100) } }),
    );
    this.buildsTokenSecret = vault.secret({
      id: `${id}-builds-token`,
      value: this.buildsToken.credentials.Value,
    });

    const settingsKey = `outpost-settings/${id}`;
    this.worker = worker({
      id,
      compatibilityDate: COMPATIBILITY_DATE,
      // Cloudflare refuses a Worker's fetch of another workers.dev URL on the
      // same account without it, and containers reply through the router's.
      // isomorphic-git and memfs need Node's APIs.
      compatibilityFlags: ["global_fetch_strictly_public", "nodejs_compat"],
      code: workerBundle(`${id}-deployer`, "deployer", { "factory:dockerfile": dockerfileModule() }),
      url: false,
      bindings: () => ({
        [KV_BINDING]: router.kv,
        // Keeps outposts' worktrees and sessions while their containers sleep.
        [R2_BINDING]: router.bucket,
        // Runs outposts' configs, each in an isolate with no network.
        LOADER: workerLoader(),
        CLOUDFLARE_API_TOKEN: this.tokenSecret.secret,
        FACTORY_ROOT_KEY: router.rootKey.secret,
        CLOUDFLARE_ACCOUNT_ID: json(accountId),
        KNOWN_HOSTS: json(knownHosts),
        CLOUDFLARE_BUILDS_TOKEN: this.buildsTokenSecret.secret,
        OUTPOST_SETTINGS_KEY: json(settingsKey),
        ACCOUNTS: json(
          Object.fromEntries(
            accounts.map((a) => [a.runtime.id, Object.keys(a.secrets)]),
          ),
        ),
      }),
    });
    if (!isWorkerGroup(this.worker)) throw new Error(`worker() didn't return a WorkerGroup for the deployer ${id}.`);
    this.add(
      kvJson({
        id: `${id}-outpost-settings`,
        namespace: router.kv,
        key: settingsKey,
        schema: OutpostSettingsSchema,
        value: {
          accountId,
          namespace: this.namespace.outputRef("Name"),
          prefix: scopedName(`${id}-outpost`, OUTPOST_PREFIX_MAX_LENGTH),
          deployer: this.worker.script.outputRef("ScriptName"),
          compatibilityDate: COMPATIBILITY_DATE,
          sleepAfter,
          ...(regions && { regions }),
        },
      }),
    );
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
