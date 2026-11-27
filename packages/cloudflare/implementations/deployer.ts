import { readFileSync } from "node:fs";
import { deferredOutputRef, type OutputRef, ResourceGroup } from "@notation/resource";
import {
  type Account,
  bindingName,
  type Deployer as DeployerContract,
  type OutpostSecret,
  reposOverlap,
  scopedName,
} from "@notation/factory";
import { kvJson } from "@notation/cloudflare/kv";
import {
  $durableObject,
  addBindings,
  json,
  type Worker,
  type WorkerGroup,
  worker,
  workerLoader,
} from "@notation/cloudflare/workers";
import * as v from "valibot";
import { DEPLOYER_BINDING, KV_BINDING, R2_BINDING } from "./bindings.ts";
import { COMPATIBILITY_DATE, workerBundle } from "./code.ts";
import { ArtifactsNamespace, type ArtifactsNamespaceInstance } from "../resources/artifacts.ts";
import { BuildsToken, type BuildsTokenInstance } from "../resources/builds-token.ts";
import { OutpostWorkers } from "../resources/outpost-workers.ts";
import { OutpostSettingsSchema } from "../workers/outpost-settings.ts";
import type { Router } from "./router.ts";
import {
  assertCloudflareSecret,
  type CloudflareSecret,
  type Vault,
} from "./vault.ts";

const deployerConfig = v.object({
  /**
   * The Cloudflare account that outpost Workers are created in.
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
  /**
   * How many instances of each outpost container run at once. Each
   * worktree gets its own instance, so runs in this many worktrees go at
   * once, and the others wait for an instance to be free.
   */
  maxInstances: v.optional(
    v.pipe(v.number(), v.integer("maxInstances is a whole number."), v.minValue(1, "maxInstances is at least 1.")),
    5,
  ),
});
export type DeployerConfig = v.InferInput<typeof deployerConfig>;

export type DeployerOptions = DeployerConfig & {
  router: Router;
  vault: Vault;
  accounts?: Account[];
  /** Secrets for the containers of the repos that each one allows. */
  secrets?: OutpostSecret[];
};

/** A module whose default export is Factory's default outpost Dockerfile. */
const dockerfileModule = () =>
  `export default ${JSON.stringify(readFileSync(new URL("../image/Dockerfile", import.meta.url), "utf8"))};`;

/**
 * A module whose default export is the hub's runner modules' sources, by
 * the path that outpost Workers serve them at: `runtimes/<id>.ts` for each
 * account's runtime, and `code-host.ts` for the router's code host.
 */
const runnerModulesModule = (id: string, accounts: Account[], router: Router) => {
  // The bundle reads its modules when it's declared, so the code host must be declared already.
  if (!router.codeHost) throw new Error(`Declare the infra's code host before the deployer ${id}, which serves its runner module.`);
  const modules: Record<string, string> = {};
  for (const { runtime } of accounts) {
    if (runtime.runner) modules[`runtimes/${runtime.id}.ts`] = runtime.runner;
  }
  if (router.codeHost.runner) modules["code-host.ts"] = router.codeHost.runner;
  return `export default ${JSON.stringify(modules)};`;
};

const workerRegistration = Symbol.for("@notation/cloudflare/WorkerDeclaration");

/**
 * A ref to the generated name of a Worker from `worker()`. Notation builds
 * the Worker's script once the infra modules have loaded, and has no public
 * API for its name yet, so this reads Notation's registration of the Worker.
 */
const scriptNameRef = (declaration: Worker) =>
  deferredOutputRef({
    resourceId: `worker:${declaration.id}`,
    key: "ScriptName",
    resolve: () => {
      const entry = (declaration as unknown as Record<symbol, { build(): WorkerGroup } | undefined>)[workerRegistration];
      if (!entry) throw new Error(`The Worker ${declaration.id} has no registration in @notation/cloudflare.`);
      return entry.build().script;
    },
  }) as OutputRef<string>;

/**
 * Throws if a container could get two values for one env var: two secrets
 * with one name whose repos overlap, or a secret with an account secret's name.
 */
const checkSecretNames = (secrets: OutpostSecret[], accounts: Account[]) => {
  const accountNames = new Set(accounts.flatMap((a) => Object.keys(a.secrets)));
  secrets.forEach((secret, i) => {
    if (accountNames.has(secret.name)) {
      throw new Error(`The outpost secret ${secret.id} has the name ${secret.name}, which an account's secret has too.`);
    }
    for (const other of secrets.slice(i + 1)) {
      if (other.name === secret.name && reposOverlap(secret.allowedRepos, other.allowedRepos)) {
        throw new Error(
          `The outpost secrets ${secret.id} and ${other.id} both have the name ${secret.name}, and a repo that both allow would get two values.`,
        );
      }
    }
  });
};

/** Leaves room in an outpost Worker's name for `-` and a 12-character hash, within a DNS label. */
const OUTPOST_PREFIX_MAX_LENGTH = 50;

/**
 * `new cloudflare.Deployer(...)`: a Worker that evaluates outposts' configs.
 * For each repo's container, it commits the container's source to an
 * Artifacts repo, and Workers Builds builds the image and deploys an outpost
 * Worker that hosts the container. It builds with a user API token, which
 * deploy asks you for once, and reports each build to the router. It binds
 * the root key, the accounts' secrets and the outpost secrets. Destroying it deletes the outpost
 * Workers and their container applications.
 */
export class Deployer
  extends ResourceGroup<DeployerConfig>
  implements DeployerContract
{
  readonly router: Router;
  readonly vault: Vault;
  readonly accounts: Account[];
  /** Holds each outpost Worker's source. */
  readonly namespace: ArtifactsNamespaceInstance;
  /** The user API token that the deployer builds outpost Workers with. */
  readonly buildsToken: BuildsTokenInstance;
  /** Holds the builds token's value. */
  readonly buildsTokenSecret: CloudflareSecret;
  readonly worker: Worker;

  constructor(
    id: string,
    { router, vault, accounts = [], secrets = [], ...config }: DeployerOptions,
  ) {
    const {
      regions,
      sleepAfter,
      maxInstances,
      accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
    } = v.parse(deployerConfig, config);
    if (!accountId) {
      throw new Error(
        `The deployer ${id} needs the Cloudflare account to create outpost Workers in. Set CLOUDFLARE_ACCOUNT_ID, or pass accountId.`,
      );
    }
    checkSecretNames(secrets, accounts);
    super("cloudflare/Deployer", id, config);
    this.router = router;
    this.vault = vault;
    this.accounts = accounts;

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

    const outpostSecrets = secrets.map((secret) => ({
      name: secret.name,
      binding: `OUTPOST_${bindingName(secret.id)}`,
      allowedRepos: secret.allowedRepos,
      stored: vault.secret({ id: `outpost-${secret.id}`, value: secret.value }),
    }));

    const settingsKey = `outpost-settings/${id}`;
    const prefix = scopedName(`${id}-outpost`, OUTPOST_PREFIX_MAX_LENGTH);
    this.worker = worker({
      id,
      compatibilityDate: COMPATIBILITY_DATE,
      // Cloudflare refuses a Worker's fetch of another workers.dev URL on the
      // same account without it, and containers reply through the router's.
      // isomorphic-git and memfs need Node's APIs.
      compatibilityFlags: ["global_fetch_strictly_public", "nodejs_compat"],
      code: workerBundle(`${id}-deployer`, "deployer", {
        "factory:dockerfile": dockerfileModule(),
        "factory:runner-modules": runnerModulesModule(id, accounts, router),
      }),
      url: false,
      bindings: () => ({
        [KV_BINDING]: router.kv,
        // Keeps outposts' worktrees and sessions while their containers sleep.
        [R2_BINDING]: router.bucket,
        // Runs outposts' configs, each in an isolate with no network.
        LOADER: workerLoader(),
        // Polls Workers Builds for the builds that the deployer starts. The
        // class is a stand-in: Notation reads only its name, and the
        // deployer's bundle exports the real one.
        BUILDS: $durableObject({ id: `${id}-builds`, class: class BuildWatch {} }),
        FACTORY_ROOT_KEY: router.rootKey.secret,
        CLOUDFLARE_BUILDS_TOKEN: this.buildsTokenSecret.secret,
        OUTPOST_SETTINGS_KEY: json(settingsKey),
        ACCOUNTS: json(
          Object.fromEntries(
            accounts.map((a) => [
              a.runtime.id,
              { secrets: Object.keys(a.secrets), ...(a.runtime.setup && { setup: a.runtime.setup }) },
            ]),
          ),
        ),
        OUTPOST_SECRETS: json(outpostSecrets.map(({ name, binding, allowedRepos }) => ({ name, binding, allowedRepos }))),
      }),
    });
    this.add(
      kvJson({
        id: `${id}-outpost-settings`,
        namespace: router.kv,
        key: settingsKey,
        schema: OutpostSettingsSchema,
        value: {
          accountId,
          namespace: this.namespace.outputRef("Name"),
          prefix,
          deployer: scriptNameRef(this.worker),
          router: router.url,
          routerWorker: scriptNameRef(router.worker),
          compatibilityDate: COMPATIBILITY_DATE,
          sleepAfter,
          maxInstances,
          ...(regions && { regions }),
        },
      }),
    );
    this.add(
      new OutpostWorkers(`outposts:${id}-outposts`, {
        config: { AccountId: accountId, Prefix: prefix, Deployer: scriptNameRef(this.worker) },
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
    for (const { binding, stored } of outpostSecrets) {
      addBindings(this.worker, { [binding]: stored.secret });
    }
  }
}
