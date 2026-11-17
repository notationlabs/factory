import { evaluateOutpost } from "@notation/factory/deployer";
import { loaderContext } from "../loader.ts";
import type { WorkerLoader } from "../types.ts";

// Serves the deployer's evaluate over fetch, for deployer.test.ts.
export default {
  async fetch(request: Request, env: { LOADER: WorkerLoader }) {
    const { repo, files } = (await request.json()) as {
      repo: string;
      files: Record<string, string>;
    };
    try {
      return Response.json({ outpost: await evaluateOutpost(repo, files, loaderContext(env.LOADER)) });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) });
    }
  },
};
