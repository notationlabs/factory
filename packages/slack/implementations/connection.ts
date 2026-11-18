import { ResourceGroup, text } from "@notation/resource";
import {
  type Connection as ConnectionContract,
  type Router,
  scopedName,
} from "@notation/factory";
import { webhookPath } from "@notation/factory/router";
import * as v from "valibot";
import { App, type AppInstance } from "../resources/app.ts";
import { ConnectionRef } from "./connection-ref.ts";

/** Slack app names are at most 35 characters. */
const SLACK_APP_NAME_MAX_LENGTH = 35;

const connectionConfig = v.object({
  /** The Slack workspace the app is installed in. */
  workspace: v.string(),
});
export type ConnectionConfig = v.InferInput<typeof connectionConfig>;

export type ConnectionOptions = ConnectionConfig & { router: Router };

/**
 * `new slack.Connection(...)`: Notation Factory on Slack, as one app whose events go
 * to the router. Its bot token and signing secret go from the app to the
 * router's vault in memory. Slack is a channel only:
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
    const { workspace } = v.parse(connectionConfig, config);
    super("slack/Connection", id, config);
    this.name = id;
    this.router = router;
    const key = `slack/${id}`;
    this.app = this.add(
      new App(`${id}-app`, {
        config: {
          name: scopedName(id, SLACK_APP_NAME_MAX_LENGTH),
          workspace,
          requestUrl: text`${router.url}${webhookPath(key)}`,
        },
      }),
    );
    const botToken = this.router.bind(
      this.router.vault.secret({
        id: `${id}-bot-token`,
        value: this.app.credentials.botToken,
      }),
    );
    const signingSecret = this.router.bind(
      this.router.vault.secret({
        id: `${id}-signing-secret`,
        value: this.app.credentials.signingSecret,
      }),
    );
    this.router.store.contribute({
      connections: {
        [key]: {
          provider: "slack",
          source: this.app.outputRef("appId"),
          credentials: {
            botToken,
            signingSecret,
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
