# `@notation/factory-slack`

`@notation/factory-slack` lets agents listen and reply in Slack channels. The same entrypoint serves both config files:

```bash
@pm.dev("@notation/factory-slack")
```

| Used in | Exports |
| --- | --- |
| `factory.infra.ts` | `slack.Connection` (provisions the Slack app and its event subscription) |
| `.factory/config.ts` | `Connection.get`, `channel.mention`, `group`, `user` |

Slack is a channel only. Code still lives on the infra's code host.

## Connection

Register a Slack app and point its events at your router:

```ts [factory.infra.ts]
import * as cloudflare from "@notation/factory-cloudflare";
import * as slack from "@notation/factory-slack";

const vault = new cloudflare.Vault("vault");
const router = new cloudflare.Router("router", {
  project: "acme-agents",
  vault,
});

new slack.Connection("slack", {
  name: "acme-agents", // <-- Slack app name; repos look the connection up by it
  workspace: "acme",   // <-- the Slack workspace it's installed in
  router,
});
```

An app that doesn't exist yet is created from a manifest in your browser, with its Events API request URL set to `<Url>/webhook`, where `Url` is the router's `Url` output. The app is protected: `factory infra down` leaves it.

The connection declares two secrets in the hub vault, `slack-bot-token` and `slack-signing-secret`. The connection binds them to the router with `router.bind(...)`, which names each binding after the secret's id: here `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`. The deployer doesn't bind them. The ids are `<id>-bot-token` and `<id>-signing-secret`, so each Slack connection in one hub gets its own bindings. Their values are the app's credentials `botToken` and `signingSecret`, which the app's create returns when it creates the app and installs it to the workspace. Deploy writes them to the vault in memory. When deploy needs a value again, such as after a vault secret was deleted, plan fails: copy the value from the app's settings page, and pass it with `notation deploy --credential`. See [Secrets](../manual/secrets.md#a-credential-that-deploy-cant-get-again).

## Channel

Listen in one Slack channel:

```ts [.factory/config.ts]
import * as slack from "@notation/factory-slack";

const ops = slack.Connection.get("acme-agents").channel({ id: "ops", scope: "#ops" }); // <-- `scope` is required and starts with `#`
```

The grant is the bot's membership: invite it with `/invite @acme-agents` in `#ops`. A repo whose triggers use a channel the bot isn't in fails its deploy with `#ops isn't granted`. A Slack channel belongs to at most one repo.

## Selectors

Wake an agent when someone mentions the bot:

```ts [.factory/config.ts]
new Trigger("slack", {
  event: ops.mention("@claude", { from: slack.group("eng") }), // <-- `from` is required
  agent: coder,
  container: dev, // <-- no worktree: the agent starts on the default branch
});
```

| Author set | Matches |
| --- | --- |
| `slack.group("eng")` | Members of a Slack user group |
| `slack.user("dan@acme.dev")` | One user, by email |

A conversation is a Slack thread. The agent's reply is posted in the thread by the bot, through the router's relay. Containers never hold the bot token: it covers the whole workspace and can't be narrowed.
