import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import type { CodeHost as CodeHostContract, RepoPattern } from "lightbox";
import * as v from "valibot";
import type { Connection } from "./connection.ts";

const codeHostConfig = v.object({
  allow: v.array(v.object({ owner: v.string(), repo: v.optional(v.string()) })),
});
export type CodeHostConfig = v.InferInput<typeof codeHostConfig>;

export type CodeHostOptions = ResourceOpts<
  CodeHostConfig,
  { connection: Connection }
>;

/**
 * `new github.CodeHost(...)`: the infra's repos are on GitHub. Installed repos
 * that match `allow` get outposts, and the router mints their containers'
 * installation tokens through the connection's App. Those last an hour and can
 * be limited to one repo and a set of permissions, so every `github.Policy`
 * passes.
 */
export class CodeHost
  extends ResourceGroup<CodeHostConfig, { connection: Connection }>
  implements CodeHostContract
{
  readonly connection: Connection;
  readonly allow: RepoPattern[];

  constructor({ id, config, dependencies }: CodeHostOptions) {
    const { allow } = v.parse(codeHostConfig, config);
    super("github/CodeHost", { id, config, dependencies });
    this.connection = dependencies.connection;
    this.allow = allow;
    this.connection.router.store.contribute(
      {
        codeHost: {
          provider: "github",
          connection: this.connection.name,
          allow,
        },
      },
      { by: `code host ${id}` },
    );
  }
}
