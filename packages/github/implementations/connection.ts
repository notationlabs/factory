import { ResourceGroup } from "@notation/resource";
import {
  type Connection as ConnectionContract,
  type Router,
  secret,
} from "@notation/factory";
import * as v from "valibot";
import { App, type AppInstance } from "../resources/app.ts";
import { ConnectionRef } from "./connection-ref.ts";

const connectionConfig = v.object({
  name: v.string(),
  org: v.optional(v.string()),
});
export type ConnectionConfig = v.InferInput<typeof connectionConfig>;

export type ConnectionOptions = ConnectionConfig & { router: Router };

/**
 * `new github.Connection(...)`: Notation Factory on GitHub, as one App whose webhook
 * is the router. Its private key goes straight into the router's vault, and
 * the router is the only thing that reads it.
 */
export class Connection
  extends ResourceGroup<ConnectionConfig>
  implements ConnectionContract
{
  readonly name: string;
  readonly router: Router;
  readonly app: AppInstance;

  constructor(id: string, { router, ...config }: ConnectionOptions) {
    const { name, org } = v.parse(connectionConfig, config);
    super("github/Connection", id, config);
    this.name = name;
    this.router = router;
    this.app = this.add(
      new App(`${id}-app`, {
        config: { name, org },
        dependencies: { router: router.api },
      }),
    );
    this.app.contribute({
      events: ["issues", "issue_comment", "push"],
      permissions: {
        contents: "write",
        issues: "write",
        pull_requests: "write",
        actions_variables: "write",
        metadata: "read",
      },
    });
    const privateKey = `github-${name}-private-key`;
    this.router.vault.secret({
      id: `${id}-private-key`,
      name: privateKey,
      value: secret.output(this.app.outputValue("privateKey")),
    });
    this.router.store.contribute({
      connections: {
        [`github/${name}`]: {
          provider: "github",
          source: this.app.outputValue("id"),
          credentials: { privateKey },
        },
      },
    });
  }

  /** In an outpost: the connection the infra declares as `name`. */
  static get(name: string): ConnectionRef {
    return new ConnectionRef(name, { name });
  }
}
