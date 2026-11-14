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

/** Turns a connection name into the part of an env var name, such as `my-app` into `MY_APP`. */
const envName = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "_");

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
    const botToken = this.router.vault.secret({
      id: `${id}-bot-token`,
      binding: `SLACK_${envName(name)}_BOT_TOKEN`,
      consumers: ["router"],
    });
    const signingSecret = this.router.vault.secret({
      id: `${id}-signing-secret`,
      binding: `SLACK_${envName(name)}_SIGNING_SECRET`,
      consumers: ["router"],
    });
    this.router.store.contribute({
      connections: {
        [`slack/${name}`]: {
          provider: "slack",
          source: this.app.outputRef("appId"),
          credentials: {
            botToken: botToken.binding,
            signingSecret: signingSecret.binding,
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
