import { factory, secret } from "factory";
import * as claude from "@factory/claude";
import * as cloudflare from "@factory/cloudflare";
import * as github from "@factory/github";
import * as slack from "@factory/slack";

export default factory(() => {
  const vault = new cloudflare.Vault({ id: "vault" });

  const router = new cloudflare.Router({
    id: "router",
    config: { project: "acme-agents" },
    dependencies: { vault },
  });

  const gh = new github.Connection({
    id: "gh",
    config: { name: "acme-agents", org: "acme" },
    dependencies: { router },
  });

  new github.CodeHost({
    id: "github",
    config: { allow: [{ owner: "acme" }] },
    dependencies: { connection: gh },
  });

  new github.OperatorAuth({
    id: "operators",
    config: { logins: ["djgrant", "alice"] },
    dependencies: { connection: gh },
  });

  new slack.Connection({
    id: "slack",
    config: { name: "acme-agents", workspace: "acme" },
    dependencies: { router },
  });

  const claudeAccount = new claude.Account({
    id: "claude",
    config: { auth: secret.env("CLAUDE_CODE_OAUTH_TOKEN") },
  });

  new cloudflare.Deployer({
    id: "deployer",
    config: { knownHosts: ["ssh-ed25519 AAAA... me@laptop"] },
    dependencies: { router, accounts: [claudeAccount] },
  });
});
