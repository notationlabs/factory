import { factory, secret } from "@notation/factory";
import * as claude from "@notation/factory-claude";
import * as cloudflare from "@notation/factory-cloudflare";
import * as github from "@notation/factory-github";
import * as slack from "@notation/factory-slack";

export default factory(() => {
  const vault = new cloudflare.Vault("vault");

  const router = new cloudflare.Router("router", {
    project: "acme-agents",
    vault,
  });

  const gh = new github.Connection("gh", {
    name: "acme-agents",
    org: "acme",
    router,
  });

  new github.CodeHost("github", {
    allow: [{ owner: "acme" }],
    connection: gh,
  });

  new github.OperatorAuth("operators", {
    logins: ["djgrant", "alice"],
    connection: gh,
  });

  new slack.Connection("slack", {
    name: "acme-agents",
    workspace: "acme",
    router,
  });

  const claudeAccount = new claude.Account("claude", {
    auth: secret.env("CLAUDE_CODE_OAUTH_TOKEN"),
  });

  new cloudflare.Deployer("deployer", {
    knownHosts: ["ssh-ed25519 AAAA... me@laptop"],
    router,
    vault,
    accounts: [claudeAccount],
  });
});
