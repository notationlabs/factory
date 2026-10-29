import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import {
  type Connection as ConnectionContract,
  type Router,
  secret,
} from "lightbox";
import * as v from "valibot";
import { App, type AppInstance } from "../resources/app.ts";
import { ConnectionRef } from "./connection-ref.ts";

const connectionConfig = v.object({
  name: v.string(),
  /** The Slack workspace the app is installed in. */
  workspace: v.string(),
});

export type ConnectionOptions = ResourceOpts<
  v.InferInput<typeof connectionConfig>,
  { router: Router }
>;

/**
 * `new slack.Connection(...)`: lightbox on Slack, as one app whose events go
 * to the router. Its bot token and signing secret are pasted on the first
 * deploy and go straight into the router's vault. Slack is a channel only:
 * code still lives on the code host.
 */
export class Connection extends ResourceGroup implements ConnectionContract {
  readonly name: string;
  readonly router: Router;
  readonly app: AppInstance;

  constructor({ id, config, dependencies }: ConnectionOptions) {
    const { name, workspace } = v.parse(connectionConfig, config);
    super("slack/Connection", {
      config,
      dependencies: { router: dependencies.router.id },
    });
    this.name = name;
    this.router = dependencies.router;
    this.app = this.add(
      new App({
        id: `${id}-app`,
        config: { name, workspace },
        dependencies: { router: dependencies.router.api },
      }),
    );
    const botToken = `slack-${name}-bot-token`;
    const signingSecret = `slack-${name}-signing-secret`;
    this.router.vault.secret({
      id: `${id}-bot-token`,
      name: botToken,
      value: secret.prompt(`Bot token for the ${name} Slack app`),
    });
    this.router.vault.secret({
      id: `${id}-signing-secret`,
      name: signingSecret,
      value: secret.prompt(`Signing secret for the ${name} Slack app`),
    });
    this.router.store.contribute(
      {
        connections: {
          [`slack/${name}`]: {
            provider: "slack",
            source: this.app.out.appId,
            credentials: { botToken, signingSecret },
          },
        },
      },
      { by: `connection ${id}` },
    );
  }

  /** In an outpost: the connection the infra declares as `name`. */
  static get(name: string): ConnectionRef {
    return new ConnectionRef({ id: name, config: { name } });
  }
}
