import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import type { OperatorAuth as OperatorAuthContract } from "lightbox";
import * as v from "valibot";
import type { Connection } from "./connection.ts";

const operatorAuthConfig = v.object({ logins: v.array(v.string()) });
export type OperatorAuthConfig = v.InferInput<typeof operatorAuthConfig>;

export type OperatorAuthOptions = ResourceOpts<
  OperatorAuthConfig,
  { connection: Connection }
>;

/** Operators sign in with GitHub, through the connection's App, and the router checks their login against `logins`. */
export class OperatorAuth
  extends ResourceGroup<OperatorAuthConfig>
  implements OperatorAuthContract
{
  readonly provider = "github";

  constructor({ id, config, dependencies }: OperatorAuthOptions) {
    const { logins } = v.parse(operatorAuthConfig, config);
    super("github/OperatorAuth", {
      config,
      dependencies: { connection: dependencies.connection.id },
    });
    dependencies.connection.router.store.contribute(
      {
        operators: {
          provider: "github",
          connection: dependencies.connection.name,
          logins,
        },
      },
      { by: `operator auth ${id}` },
    );
  }
}
