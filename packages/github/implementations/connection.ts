import { ResourceGroup } from "@notation/resource";
import {
  type Connection as ConnectionContract,
  type Router,
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

/** Turns a connection name into the part of an env var name, such as `my-app` into `MY_APP`. */
const envName = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "_");

/**
 * `new github.Connection(...)`: Notation Factory on GitHub, as one App whose webhook
 * is the router. Its private key is kept in the router's vault, and the
 * router is the only thing that reads it.
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
    // The App's create will write this once Notation supports a resource
    // writing a secret value.
    const privateKey = this.router.vault.secret({
      id: `${id}-private-key`,
      binding: `GITHUB_${envName(name)}_PRIVATE_KEY`,
      consumers: ["router"],
    });
    this.router.store.contribute({
      connections: {
        [`github/${name}`]: {
          provider: "github",
          source: this.app.outputRef("id"),
          credentials: { privateKey: privateKey.binding },
        },
      },
    });
  }

  /** In an outpost: the connection the infra declares as `name`. */
  static get(name: string): ConnectionRef {
    return new ConnectionRef(name, { name });
  }
}
