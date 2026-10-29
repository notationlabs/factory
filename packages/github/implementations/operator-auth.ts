import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import type { OperatorAuth as OperatorAuthContract } from "factory";
import * as v from "valibot";
import type { Connection } from "./connection.ts";

const operatorAuthConfig = v.object({ logins: v.array(v.string()) });

export type OperatorAuthOptions = ResourceOpts<
  v.InferInput<typeof operatorAuthConfig>,
  { connection: Connection }
>;

/** Operators sign in with GitHub, through the connection's App, and the router checks their login against `logins`. */
export class OperatorAuth extends ResourceGroup implements OperatorAuthContract {
  readonly provider = "github";

  constructor({ id, config, dependencies }: OperatorAuthOptions) {
    const { logins } = v.parse(operatorAuthConfig, config);
    super("github/OperatorAuth", {
      logins,
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
