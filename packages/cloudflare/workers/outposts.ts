import { deriveKey, hmacHex, type OutpostConfig, type Run, timingSafeEqual } from "@notation/factory/router";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { Volume } from "memfs";
import * as v from "valibot";
import defaultDockerfile from "factory:dockerfile";
import { deleteRepo, ensureRepo, repoToken } from "../lib/artifacts.ts";
import { cloudflare, cloudflareOrNone } from "../lib/cloudflare-api.ts";
import { CONTAINER_CLASS, RUN_HEADERS } from "./outpost-api.ts";
import outpostBundle from "./outpost.gen.ts";
import { type OutpostSettings, OutpostSettingsSchema } from "./outpost-settings.ts";
import type { KVNamespace, SecretsStoreSecret } from "./types.ts";

export type OutpostsEnv = {
  FACTORY_KV: KVNamespace;
  FACTORY_ROOT_KEY: SecretsStoreSecret;
  /** A user API token, since the Workers Builds API refuses account tokens. */
  CLOUDFLARE_BUILDS_TOKEN: SecretsStoreSecret;
  /** The KV key of the outpost settings. */
  OUTPOST_SETTINGS_KEY: string;
};

const settingsOf = async (env: OutpostsEnv): Promise<OutpostSettings> => {
  const settings = await env.FACTORY_KV.get(env.OUTPOST_SETTINGS_KEY, "json");
  if (!settings) throw new Error(`The deployer has no outpost settings in KV ${env.OUTPOST_SETTINGS_KEY}. Run \`factory infra up\`.`);
  return v.parse(OutpostSettingsSchema, settings);
};

const encoder = new TextEncoder();

const sha256 = async (text: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

/** The name of the outpost Worker of a repo's container, which its Artifacts repo shares. */
export const outpostWorkerName = async (settings: OutpostSettings, repo: string, container: string) =>
  `${settings.prefix}-${(await sha256(`${repo.toLowerCase()}/${container}`)).slice(0, 12)}`;

/** The KV key of the names of a repo's outpost Workers, by container id. */
const workersKey = (repo: string) => `outpost-workers/${repo.toLowerCase()}`;

/** The KV key of the hash of the source that an outpost Worker was last built from. */
const sourceKey = (worker: string) => `outpost-source/${worker}`;

const runKey = (rootKey: string, worker: string) => deriveKey(rootKey, `outpost:${worker}`);

const signed = (key: string, timestamp: string, body: string) => hmacHex(key, `${timestamp}.${body}`);

export const verifyRun = async (env: OutpostsEnv, worker: string, timestamp: string, body: string, signature: string) =>
  timingSafeEqual(await signed(await runKey(await env.FACTORY_ROOT_KEY.get(), worker), timestamp, body), signature);

/** The answer of a placeholder outpost Worker, which stands until its first build deploys. */
const PLACEHOLDER = `export default { fetch: () => new Response("building", { status: 503 }) };`;

/**
 * The files of a container's Artifacts repo:
 * 1. `.factory/`, as the repo has it.
 * 2. `Dockerfile`, Factory's default, if the container names no image.
 * 3. `wrangler.json` and `outpost.js`, the outpost Worker, which Workers
 *    Builds deploys as it is.
 */
const outpostSource = (
  settings: OutpostSettings,
  worker: string,
  container: OutpostConfig["containers"][string],
  files: Record<string, string>,
) => {
  const source: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) source[`.factory/${path}`] = content;
  let image = "./Dockerfile";
  let context = ".";
  if (container.image) {
    const path = container.image.replace(/^\.\//, "");
    if (!(path in files)) throw new Error(`The image .factory/${path} doesn't exist.`);
    image = `./.factory/${path}`;
    context = "./.factory";
  } else {
    source.Dockerfile = defaultDockerfile;
  }
  const config = {
    name: worker,
    main: "outpost.js",
    no_bundle: true,
    compatibility_date: settings.compatibilityDate,
    // Cloudflare refuses a Worker's fetch of another workers.dev URL on the
    // same account without it, and containers reply through the router's.
    compatibility_flags: ["global_fetch_strictly_public"],
    workers_dev: true,
    // Cloudflare refuses preview URLs for a Worker name over 54 characters.
    preview_urls: false,
    observability: { enabled: true },
    containers: [
      {
        // Wrangler names the application `<worker>-<class>`, and Cloudflare
        // refuses a name with `--`, which Notation's generated names have.
        name: worker.replace(/-{2,}/g, "-"),
        class_name: CONTAINER_CLASS,
        image,
        image_build_context: context,
        max_instances: 1,
        instance_type: "standard-1",
        ...(settings.regions && { constraints: { regions: settings.regions } }),
      },
    ],
    durable_objects: { bindings: [{ name: "OUTPOSTS", class_name: CONTAINER_CLASS }] },
    migrations: [{ tag: "v1", new_sqlite_classes: [CONTAINER_CLASS] }],
    services: [{ binding: "DEPLOYER", service: settings.deployer }],
    vars: { WORKER_NAME: worker, SLEEP_AFTER: settings.sleepAfter },
  };
  source["wrangler.json"] = `${JSON.stringify(config, null, 2)}\n`;
  source["outpost.js"] = outpostBundle;
  return source;
};

/** Commits `files` as a root commit, and force-pushes it to `main` of `remote`. */
const pushSource = async (remote: string, token: string, files: Record<string, string>, message: string) => {
  const fs = Volume.fromJSON({}) as unknown as Parameters<typeof git.init>[0]["fs"] & {
    mkdirSync(path: string, options: { recursive: true }): void;
    writeFileSync(path: string, content: string): void;
  };
  const dir = "/repo";
  await git.init({ fs, dir, defaultBranch: "main" });
  for (const [path, content] of Object.entries(files)) {
    const full = `${dir}/${path}`;
    fs.mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
    fs.writeFileSync(full, content);
    await git.add({ fs, dir, filepath: path });
  }
  await git.commit({ fs, dir, message, author: { name: "Notation Factory", email: "notation-factory@users.noreply.github.com" } });
  const result = await git.push({
    fs,
    http,
    dir,
    url: remote,
    ref: "main",
    force: true,
    headers: { authorization: `Bearer ${token}` },
  });
  if (!result.ok) throw new Error(`The push to the outpost's Artifacts repo failed: ${result.error ?? "no reason given"}`);
};

/** The build token that Workers Builds deploys with: the builds token, which this registers once. */
const buildToken = async (token: string, accountId: string, kv: KVNamespace) => {
  const { id } = await cloudflare<{ id: string }>(token, "GET", "/user/tokens/verify");
  const key = `build-token/${id}`;
  const cached = await kv.get(key);
  if (cached) return cached;
  const tokens = await cloudflare<{ build_token_uuid: string; cloudflare_token_id: string }[]>(
    token,
    "GET",
    `/accounts/${accountId}/builds/tokens`,
  );
  const uuid =
    tokens.find((t) => t.cloudflare_token_id === id)?.build_token_uuid ??
    (
      await cloudflare<{ build_token_uuid: string }>(token, "POST", `/accounts/${accountId}/builds/tokens`, {
        build_token_name: "notation-factory-deployer",
        build_token_secret: token,
        cloudflare_token_id: id,
      })
    ).build_token_uuid;
  await kv.put(key, uuid);
  return uuid;
};

/** The tag of the Worker `worker`, which this uploads as a placeholder if it doesn't exist. */
const ensureWorker = async (token: string, settings: OutpostSettings, worker: string) => {
  const path = `/accounts/${settings.accountId}/workers/services/${worker}`;
  const found = await cloudflareOrNone<{ default_environment: { script: { tag: string } } }>(token, "GET", path);
  if (found) return found.default_environment.script.tag;
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify({ main_module: "placeholder.js", compatibility_date: settings.compatibilityDate })], {
      type: "application/json",
    }),
  );
  form.append("placeholder.js", new Blob([PLACEHOLDER], { type: "application/javascript+module" }), "placeholder.js");
  const uploaded = await cloudflare<{ tag: string }>(
    token,
    "PUT",
    `/accounts/${settings.accountId}/workers/scripts/${worker}`,
    form,
  );
  return uploaded.tag;
};

/** Starts a build of `main` for the Worker `tag`, creating its build config from the Artifacts repo first if it has none. */
const build = async (
  token: string,
  settings: OutpostSettings,
  worker: string,
  tag: string,
  repo: { id: string },
  buildTokenUuid: string,
) => {
  const base = `/accounts/${settings.accountId}/builds`;
  let triggers = await cloudflare<{ trigger_uuid: string }[]>(token, "GET", `${base}/workers/${tag}/triggers`);
  if (triggers.length === 0) {
    const build = { build_command: "", deploy_command: "npx wrangler deploy", build_token_uuid: buildTokenUuid, root_directory: "/" };
    await cloudflare(token, "POST", `${base}/workers`, {
      script_tag: tag,
      previews_enabled: false,
      previews_base_config: build,
      production_settings: build,
      git_repository: {
        provider_type: "cloudflare_artifacts",
        provider_account_id: settings.namespace,
        provider_account_name: settings.namespace,
        repo_id: repo.id,
        repo_name: worker,
        branch: "main",
      },
    });
    triggers = await cloudflare(token, "GET", `${base}/workers/${tag}/triggers`);
  }
  const trigger = triggers[0];
  if (!trigger) throw new Error(`Workers Builds has no build trigger for ${worker}.`);
  await cloudflare(token, "POST", `${base}/triggers/${trigger.trigger_uuid}/builds`, { branch: "main" });
};

/**
 * Builds the outpost Worker of each of a repo's containers, and deletes the
 * Workers of containers the repo no longer has:
 * 1. Commits the container's source to its Artifacts repo, unless it's the
 *    source that the Worker was last built from.
 * 2. Creates the Worker as a placeholder, if it doesn't exist, and its build
 *    config.
 * 3. Starts a build, which builds the image and deploys the Worker.
 */
export const deployOutposts = async (
  env: OutpostsEnv,
  repo: string,
  outpost: OutpostConfig | undefined,
  files: Record<string, string>,
) => {
  const settings = await settingsOf(env);
  const token = await env.CLOUDFLARE_BUILDS_TOKEN.get();
  const kv = env.FACTORY_KV;
  const previous = ((await kv.get(workersKey(repo), "json")) ?? {}) as Record<string, string>;
  const current: Record<string, string> = {};
  for (const [id, container] of Object.entries(outpost?.containers ?? {})) {
    const worker = await outpostWorkerName(settings, repo, id);
    current[id] = worker;
    const source = outpostSource(settings, worker, container, files);
    const hash = await sha256(JSON.stringify(Object.entries(source).sort(([a], [b]) => a.localeCompare(b))));
    if ((await kv.get(sourceKey(worker))) === hash) continue;
    const artifact = await ensureRepo(token, settings.accountId, settings.namespace, worker);
    const write = await repoToken(token, settings.accountId, settings.namespace, worker);
    await pushSource(artifact.remote, write, source, `${repo}: container ${id}`);
    const tag = await ensureWorker(token, settings, worker);
    await build(token, settings, worker, tag, artifact, await buildToken(token, settings.accountId, kv));
    await kv.put(sourceKey(worker), hash);
    console.log(JSON.stringify({ repo, container: id, worker, building: true }));
  }
  for (const [id, worker] of Object.entries(previous)) {
    if (current[id] === worker) continue;
    await cloudflareOrNone(token, "DELETE", `/accounts/${settings.accountId}/workers/scripts/${worker}?force=true`);
    await deleteRepo(token, settings.accountId, settings.namespace, worker);
    await kv.delete(sourceKey(worker));
    console.log(JSON.stringify({ repo, container: id, worker, deleted: true }));
  }
  if (Object.keys(current).length) await kv.put(workersKey(repo), JSON.stringify(current));
  else await kv.delete(workersKey(repo));
};

/** The account's workers.dev subdomain, which outpost Workers' URLs are under. */
const subdomain = async (env: OutpostsEnv, settings: OutpostSettings) => {
  const key = "workers-subdomain";
  const cached = await env.FACTORY_KV.get(key);
  if (cached) return cached;
  const { subdomain } = await cloudflare<{ subdomain: string }>(
    await env.CLOUDFLARE_BUILDS_TOKEN.get(),
    "GET",
    `/accounts/${settings.accountId}/workers/subdomain`,
  );
  await env.FACTORY_KV.put(key, subdomain);
  return subdomain;
};

/** Posts `run` to the outpost Worker of its repo's container, signed with the Worker's key. */
export const postRun = async (env: OutpostsEnv, run: Run) => {
  const settings = await settingsOf(env);
  const worker = await outpostWorkerName(settings, run.repo, run.container);
  const body = JSON.stringify(run);
  const timestamp = String(Date.now());
  const signature = await signed(await runKey(await env.FACTORY_ROOT_KEY.get(), worker), timestamp, body);
  const response = await fetch(`https://${worker}.${await subdomain(env, settings)}.workers.dev/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", [RUN_HEADERS.timestamp]: timestamp, [RUN_HEADERS.signature]: signature },
    body,
  });
  const text = await response.text();
  if (response.status === 503 && text === "building") {
    throw new Error(`The container \`${run.container}\` has no image yet. Its first build hasn't finished.`);
  }
  if (!response.ok) {
    throw new Error(`The container \`${run.container}\`'s Worker ${worker} refused the run with status ${response.status}: ${text.slice(0, 500)}`);
  }
};
