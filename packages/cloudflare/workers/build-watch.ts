import { DurableObject } from "cloudflare:workers";
import { type BuildReport, signBuildReport } from "@notation/factory/router";
import { cloudflare } from "../lib/cloudflare-api.ts";
import { type OutpostsEnv, settingsOf, sourceKey } from "./outposts.ts";
import type { OutpostSettings } from "./outpost-settings.ts";

/** A build that the deployer started, by pushing `commit` to the Artifacts repo of the outpost Worker `worker`. */
export type StartedBuild = {
  container: string;
  worker: string;
  /** The Worker's tag, which Workers Builds lists its builds by. */
  tag: string;
  commit: string;
  /** The hash of the source that the deployer pushed. */
  hash: string;
  /**
   * The uuid of the build, when the deployer started it itself. A build
   * started by branch, not by a push, may not carry the pushed commit.
   */
  build?: string;
};

/** A started build, with the code host's repo and the commit that `.factory/` was read at. */
export type WatchedBuild = StartedBuild & { repo: string; ref: string };

type Stored = WatchedBuild & {
  since: number;
  url?: string;
  /** When the deployer starts the build again, after the first build failed. */
  retryAt?: number;
  /** Set once the deployer has started the build again, so that it retries only once. */
  retried?: boolean;
};

type Build = {
  build_uuid: string;
  status: "queued" | "initializing" | "running" | "stopped";
  build_outcome: "success" | "fail" | "skipped" | "cancelled" | "terminated" | null;
  build_trigger_metadata?: { commit_hash?: string };
};

const POLL_MS = 30_000;

/** How long a build may take to start and finish before the deployer stops watching it. */
const GIVE_UP_MS = 2 * 60 * 60 * 1000;

const REPORT_TTL_MS = 5 * 60 * 1000;

/** How long the deployer waits before it starts a failed build again, so that a short outage on Cloudflare's side can pass. */
const RETRY_DELAY_MS = 2 * 60 * 1000;

const buildUrl = (accountId: string, worker: string, uuid: string) =>
  `https://dash.cloudflare.com/${accountId}/workers/services/view/${worker}/production/builds/${uuid}`;

/**
 * Watches the builds that the deployer started, and reports each one's
 * progress to the router's `/builds` route. The deployer hosts one object.
 */
export class BuildWatch extends DurableObject<OutpostsEnv> {
  async watch(builds: WatchedBuild[]) {
    for (const build of builds) {
      await this.ctx.storage.put(`${build.worker}/${build.commit}`, { ...build, since: Date.now() });
    }
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
  }

  async alarm() {
    for (const [key, build] of (await this.ctx.storage.list()) as Map<string, Stored>) {
      try {
        const next = await this.#poll(build);
        if (next) await this.ctx.storage.put(key, next);
        else await this.ctx.storage.delete(key);
      } catch (error) {
        console.error(JSON.stringify({ worker: build.worker, commit: build.commit, error: String(error) }));
        if (Date.now() - build.since > GIVE_UP_MS) await this.ctx.storage.delete(key);
      }
    }
    if ((await this.ctx.storage.list({ limit: 1 })).size) await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
  }

  /**
   * Reports the build of `watched` once it runs and once it stops. Resolves
   * to the build to keep watching, or `undefined` when it's done.
   *
   * A build that fails or is terminated is started again once, after
   * RETRY_DELAY_MS, unless a newer source has been pushed since. Only a
   * failure of the second build is reported as a failure.
   */
  async #poll(watched: Stored): Promise<Stored | undefined> {
    const settings = await settingsOf(this.env);
    const token = await this.env.CLOUDFLARE_BUILDS_TOKEN.get();
    if (watched.retryAt !== undefined) {
      if (Date.now() < watched.retryAt) return watched;
      return this.#retry(settings, token, watched);
    }
    const builds = await cloudflare<Build[]>(
      token,
      "GET",
      `/accounts/${settings.accountId}/builds/workers/${watched.tag}/builds?per_page=10`,
    );
    const build = builds.find((b) =>
      watched.build ? b.build_uuid === watched.build : b.build_trigger_metadata?.commit_hash === watched.commit,
    );
    const late = Date.now() - watched.since > GIVE_UP_MS;
    if (!build || build.status !== "stopped") {
      if (late) {
        await this.#failed(watched);
        await this.#report(settings.router, watched, { state: "failure", summary: "The build didn't finish within 2 hours." });
        return undefined;
      }
      if (!build || watched.url) return watched;
      const url = buildUrl(settings.accountId, watched.worker, build.build_uuid);
      await this.#report(settings.router, watched, { state: "in_progress", url });
      return { ...watched, url };
    }
    const url = buildUrl(settings.accountId, watched.worker, build.build_uuid);
    const retryable = build.build_outcome === "fail" || build.build_outcome === "terminated";
    if (retryable && !watched.retried && (await this.#current(watched))) {
      await this.#report(settings.router, watched, {
        state: "in_progress",
        url,
        summary: `Workers Builds: ${build.build_outcome}. The deployer will start the build again in ${RETRY_DELAY_MS / 60_000} minutes.`,
      });
      return { ...watched, url, retryAt: Date.now() + RETRY_DELAY_MS };
    }
    const state = build.build_outcome === "success" ? "success" : build.build_outcome === "cancelled" ? "cancelled" : "failure";
    if (state !== "success") await this.#failed(watched);
    await this.#report(settings.router, watched, { state, url, summary: `Workers Builds: ${build.build_outcome ?? "no outcome"}.` });
    return undefined;
  }

  /**
   * Starts the build of `watched` again, on the Artifacts repo's `main`.
   * If a newer source was pushed in the meantime, its own build is already
   * running, so this reports the failure instead.
   */
  async #retry(settings: OutpostSettings, token: string, watched: Stored): Promise<Stored | undefined> {
    if (!(await this.#current(watched))) {
      await this.#report(settings.router, watched, {
        state: "failure",
        ...(watched.url && { url: watched.url }),
        summary: "The build failed, and a newer source is building.",
      });
      return undefined;
    }
    const base = `/accounts/${settings.accountId}/builds`;
    const [trigger] = await cloudflare<{ trigger_uuid: string }[]>(token, "GET", `${base}/workers/${watched.tag}/triggers`);
    if (!trigger) throw new Error(`Workers Builds has no build trigger for ${watched.worker}.`);
    const started = await cloudflare<{ build_uuid?: string } | null>(
      token,
      "POST",
      `${base}/triggers/${trigger.trigger_uuid}/builds`,
      { branch: "main" },
    );
    // Without the new build's uuid, the watch can't tell it apart from the failed build of the same commit.
    if (!started?.build_uuid) {
      await this.#failed(watched);
      await this.#report(settings.router, watched, {
        state: "failure",
        ...(watched.url && { url: watched.url }),
        summary: "The build failed, and Workers Builds didn't start it again.",
      });
      return undefined;
    }
    const url = buildUrl(settings.accountId, watched.worker, started.build_uuid);
    console.log(JSON.stringify({ worker: watched.worker, commit: watched.commit, retrying: started.build_uuid }));
    // The build has started, so a failed report mustn't leave the watch to start another.
    await this.#report(settings.router, watched, { state: "in_progress", url, summary: "Retrying after a failed build." }).catch(
      (error) => console.error(JSON.stringify({ worker: watched.worker, commit: watched.commit, error: String(error) })),
    );
    const { retryAt: _, ...rest } = watched;
    return { ...rest, build: started.build_uuid, url, retried: true, since: Date.now() };
  }

  /** Whether `watched`'s source is still the one the deployer last pushed for its Worker. */
  async #current(watched: Stored) {
    return (await this.env.FACTORY_KV.get(sourceKey(watched.worker))) === watched.hash;
  }

  /** Forgets the source of a failed build, so that the next push builds it again. A newer source stays. */
  async #failed(watched: Stored) {
    const key = sourceKey(watched.worker);
    if ((await this.env.FACTORY_KV.get(key)) === watched.hash) await this.env.FACTORY_KV.delete(key);
  }

  async #report(router: string, watched: Stored, fields: Pick<BuildReport, "state" | "url" | "summary">) {
    const report: BuildReport = {
      repo: watched.repo,
      ref: watched.ref,
      container: watched.container,
      ...fields,
      expires: Date.now() + REPORT_TTL_MS,
    };
    const signature = await signBuildReport(await this.env.FACTORY_ROOT_KEY.get(), report);
    const response = await fetch(`${router}/builds`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report, signature }),
    });
    if (!response.ok) {
      throw new Error(`The router refused the build report with status ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
  }
}
