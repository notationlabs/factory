import { ResourceGroup } from "@notation/resource";
import type { OperatorAuth as OperatorAuthContract } from "lightbox";
import * as v from "valibot";
import type { Connection } from "./connection.ts";

const operatorAuthConfig = v.object({ logins: v.array(v.string()) });
export type OperatorAuthConfig = v.InferInput<typeof operatorAuthConfig>;

export type OperatorAuthOptions = OperatorAuthConfig & {
  connection: Connection;
};

/** Operators sign in with GitHub, through the connection's App, and the router checks their login against `logins`. */
export class OperatorAuth
  extends ResourceGroup<OperatorAuthConfig, { connection: Connection }>
  implements OperatorAuthContract
{
  readonly provider = "github";

  constructor(id: string, { connection, ...config }: OperatorAuthOptions) {
    const { logins } = v.parse(operatorAuthConfig, config);
    super("github/OperatorAuth", id, config, { connection });
    connection.router.store.contribute(
      {
        operators: {
          provider: "github",
          connection: connection.name,
          logins,
        },
      },
      { by: `operator auth ${id}` },
    );
  }
}
