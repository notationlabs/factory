import { ResourceGroup } from "@notation/resource";
import type { OperatorAuth as OperatorAuthContract } from "@notation/factory";
import * as v from "valibot";
import type { Connection } from "./connection.ts";

const operatorAuthConfig = v.object({
  /**
   * The GitHub users who may run the CLI against the hub, each by login or
   * by numeric account id. An id keeps matching after the user renames
   * their account.
   */
  logins: v.array(v.union([v.string(), v.pipe(v.number(), v.integer())])),
});
export type OperatorAuthConfig = v.InferInput<typeof operatorAuthConfig>;

export type OperatorAuthOptions = OperatorAuthConfig & {
  connection: Connection;
};

/** Operators sign in with GitHub, through the connection's App, and the router checks their login and id against `logins`. */
export class OperatorAuth
  extends ResourceGroup<OperatorAuthConfig>
  implements OperatorAuthContract
{
  readonly provider = "github";
  readonly connection: Connection;

  constructor(id: string, { connection, ...config }: OperatorAuthOptions) {
    const { logins } = v.parse(operatorAuthConfig, config);
    super("github/OperatorAuth", id, config);
    this.connection = connection;
    connection.router.store.contribute({
      operators: {
        provider: "github",
        connection: connection.name,
        logins,
      },
    });
  }
}
