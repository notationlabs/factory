import { lightbox, secret } from "lightbox";
import * as claude from "@lightbox/claude";
import * as cloudflare from "@lightbox/cloudflare";
import * as github from "@lightbox/github";
import * as slack from "@lightbox/slack";

export default lightbox(() => {
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
