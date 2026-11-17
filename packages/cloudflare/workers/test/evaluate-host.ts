import { evaluateOutpost, worktree } from "@notation/factory/deployer";
import { loaderContext } from "../loader.ts";
import type { WorkerLoader } from "../types.ts";

// Serves the deployer's evaluate and worktree over fetch, for deployer.test.ts.
export default {
  async fetch(request: Request, env: { LOADER: WorkerLoader }) {
    const { repo, files, trigger, payload } = (await request.json()) as {
      repo: string;
      files: Record<string, string>;
      trigger?: string;
      payload?: unknown;
    };
    const context = { ...loaderContext(env.LOADER), getFiles: async () => files };
    try {
      if (trigger) return Response.json({ branch: (await worktree(repo, trigger, payload, context)) ?? null });
      return Response.json({ outpost: await evaluateOutpost(repo, files, context) });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) });
    }
  },
};
