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
  /** The Slack workspace the app is installed in. */
  workspace: v.string(),
});
export type ConnectionConfig = v.InferInput<typeof connectionConfig>;

export type ConnectionOptions = ConnectionConfig & { router: Router };

/** The names the router reads the app's credentials as. A hub has one Slack connection. */
const BOT_TOKEN_BINDING = "SLACK_BOT_TOKEN";
const SIGNING_SECRET_BINDING = "SLACK_SIGNING_SECRET";

/**
 * `new slack.Connection(...)`: Notation Factory on Slack, as one app whose events go
 * to the router. Deploy asks for its bot token and signing secret, and
 * keeps them in the router's vault. Slack is a channel only:
 * code still lives on the code host.
 */
export class Connection
  extends ResourceGroup<ConnectionConfig>
  implements ConnectionContract
{
  readonly name: string;
  readonly router: Router;
  readonly app: AppInstance;

  constructor(id: string, { router, ...config }: ConnectionOptions) {
    const { name, workspace } = v.parse(connectionConfig, config);
    super("slack/Connection", id, config);
    this.name = name;
    this.router = router;
    this.app = this.add(
      new App(`${id}-app`, {
        config: { name, workspace },
        dependencies: { router: router.api },
      }),
    );
    this.router.bind(
      BOT_TOKEN_BINDING,
      this.router.vault.secret({ id: `${id}-bot-token` }),
    );
    this.router.bind(
      SIGNING_SECRET_BINDING,
      this.router.vault.secret({ id: `${id}-signing-secret` }),
    );
    this.router.store.contribute({
      connections: {
        [`slack/${name}`]: {
          provider: "slack",
          source: this.app.outputRef("appId"),
          credentials: {
            botToken: BOT_TOKEN_BINDING,
            signingSecret: SIGNING_SECRET_BINDING,
          },
        },
      },
    });
  }

  /** In an outpost: the connection the infra declares as `name`. */
  static get(name: string): ConnectionRef {
    return new ConnectionRef(name, { name });
  }
}
