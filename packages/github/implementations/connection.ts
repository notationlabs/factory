import { fileURLToPath } from "node:url";
import { getActiveResourceCollection, ResourceGroup, text } from "@notation/resource";
import {
  type Connection as ConnectionContract,
  type Router,
} from "@notation/factory";
import { webhookPath } from "@notation/factory/router";
import * as v from "valibot";
import { appName } from "../lib/app-name.ts";
import { App, type AppInstance } from "../resources/app.ts";
import { CHANNEL_SECRETS, CHANNEL_VALUES } from "../router/index.ts";
import { ConnectionRef } from "./connection-ref.ts";

const connectionConfig = v.object({
  org: v.optional(v.string()),
});
export type ConnectionConfig = v.InferInput<typeof connectionConfig>;

export type ConnectionOptions = ConnectionConfig & { router: Router };

/**
 * `new github.Connection(...)`: Notation Factory on GitHub, as one App whose
 * webhook is the connection's path on the router. The router runs the
 * connection's channel, which reads the App's private key. The key goes from
 * the App to the router's vault in memory.
 */
export class Connection
  extends ResourceGroup<ConnectionConfig>
  implements ConnectionContract
{
  readonly name: string;
  readonly router: Router;
  readonly app: AppInstance;

  constructor(id: string, { router, ...config }: ConnectionOptions) {
    const { org } = v.parse(connectionConfig, config);
    super("github/Connection", id, config);
    this.name = id;
    this.router = router;
    const key = `github/${id}`;
    this.app = this.add(
      new App(`${id}-app`, {
        config: {
          name: appName(getActiveResourceCollection()?.scope, id),
          org,
          hookUrl: text`${router.url}${webhookPath(key)}`,
        },
      }),
    );
    this.app.contribute({
      events: ["issues", "issue_comment", "push"],
      permissions: {
        contents: "write",
        issues: "write",
        pull_requests: "write",
        actions_variables: "write",
        checks: "write",
        metadata: "read",
        // Policies can give agents these, to follow a pull request's CI.
        actions: "read",
        deployments: "read",
        statuses: "read",
      },
    });
    router.channel({
      connection: key,
      module: fileURLToPath(new URL("../router/index.ts", import.meta.url)),
      secrets: {
        [CHANNEL_SECRETS.rootKey]: router.rootKey,
        [CHANNEL_SECRETS.privateKey]: router.vault.secret({
          id: `${id}-private-key`,
          value: this.app.credentials.privateKey,
        }),
        [CHANNEL_SECRETS.clientSecret]: router.vault.secret({
          id: `${id}-client-secret`,
          value: this.app.credentials.clientSecret,
        }),
      },
      values: {
        [CHANNEL_VALUES.appId]: this.app.outputRef("id"),
        [CHANNEL_VALUES.clientId]: this.app.outputRef("clientId"),
      },
    });
    router.store.contribute({
      connections: {
        [key]: {
          provider: "github",
          source: this.app.outputRef("id"),
          credentials: {},
        },
      },
    });
  }

  /** In an outpost: the connection the infra declares as `name`. */
  static get(name: string): ConnectionRef {
    return new ConnectionRef(name, { name });
  }
}
