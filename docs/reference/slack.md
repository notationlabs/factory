# `@notation/factory-slack`

Declares Notation Factory Slack app connections, channel scopes, and mention selectors.

## Status

`@notation/factory-slack` is currently incomplete and cannot send or receive live Slack events:

- All Slack app resource API operations in `packages/slack/lib/app.ts` throw `"not implemented"`.
- No router channel module exists to verify Slack signing secrets, parse `app_mention` webhooks, or post replies.
- `Connection` does not register a channel worker with the router.

Use [`@notation/factory-github`](./github.md) for live triggers and conversations.

## Exported API

```ts [@notation/factory-slack]
const conn = new slack.Connection(id, { router, workspace });
const ref = slack.Connection.get(name);
const channel = ref.channel({ id, scope }); // scope must start with "#"
channel.mention(name, { from: [slack.group(handle), slack.user(email)] });
```

| Export | Description |
| :--- | :--- |
| `Connection` | Declares a `slack/apps/App` and binds `botToken` and `signingSecret` |
| `Connection.get` | Returns a `ConnectionRef` for `.factory/infra.ts` |
| `Channel` | Channel scope bound to a connection where `scope` must begin with `#` |
| `mention` | Emits an `app_mention` selector matching `name` |
| `group` | Matches members of a Slack user group by handle |
| `user` | Matches one Slack user by email |
