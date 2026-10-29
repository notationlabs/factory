import { factory, secret } from "factory";
import * as claude from "@factory/claude";
import * as cloudflare from "@factory/cloudflare";
import * as github from "@factory/github";
import * as slack from "@factory/slack";

export default factory(() => {
  const vault = new cloudflare.Vault("vault");

  const router = new cloudflare.Router("router", {
    config: { project: "acme-agents" },
    dependencies: { vault },
  });

  const gh = new github.Connection("gh", {
    config: { name: "acme-agents", org: "acme" },
    dependencies: { router },
  });

  new github.CodeHost("github", {
    config: { allow: [{ owner: "acme" }] },
    dependencies: { connection: gh },
  });

  new github.OperatorAuth("operators", {
    config: { logins: ["djgrant", "alice"] },
    dependencies: { connection: gh },
  });

  new slack.Connection("slack", {
    config: { name: "acme-agents", workspace: "acme" },
    dependencies: { router },
  });

  const claudeAccount = new claude.Account("claude", {
    config: { auth: secret.env("CLAUDE_CODE_OAUTH_TOKEN") },
  });

  new cloudflare.Deployer("deployer", {
    config: { knownHosts: ["ssh-ed25519 AAAA... me@laptop"] },
    dependencies: { router, accounts: [claudeAccount] },
  });
});
