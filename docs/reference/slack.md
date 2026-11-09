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
import { factory } from "@notation/factory";
import * as cloudflare from "@notation/factory-cloudflare";
import * as slack from "@notation/factory-slack";

export default factory(() => {
  const vault = new cloudflare.Vault("vault");
  const router = new cloudflare.Router("router", { project: "acme-agents", vault });

  new slack.Connection("slack", {
    name: "acme-agents", // <-- Slack app name; repos look the connection up by it
    workspace: "acme",   // <-- the Slack workspace it's installed in
    router,
  });
});
```

An app that doesn't exist yet is created from a manifest in your browser, with its Events API request URL set to `<router.url>/webhook`. Install it to the workspace, then paste its bot token and signing secret when asked (they aren't echoed). Both go straight into the hub vault, and only the router reads them. The app is protected: `factory infra down` leaves it.

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
