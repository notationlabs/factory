import { factory, secret } from "factory";
import * as claude from "@factory/claude";
import * as github from "@factory/github";
import * as railway from "@factory/railway";

export default factory(() => {
  const vault = new railway.Vault("vault");

  const router = new railway.Router("router", {
    config: { project: "acme-agents" },
    dependencies: { vault },
  });

  const gh = new github.Connection("gh", {
    config: { name: "acme-agents", org: "acme" },
    dependencies: { router },
  });

  new github.Connection("personal", {
    config: { name: "alice-agents" },
    dependencies: { router },
  });

  new github.CodeHost("github", {
    config: { allow: [{ owner: "acme" }] },
    dependencies: { connection: gh },
  });

  const claudeAccount = new claude.Account("claude", {
    config: { auth: secret.env("CLAUDE_CODE_OAUTH_TOKEN") },
  });

  new railway.Deployer("deployer", {
    dependencies: { router, accounts: [claudeAccount] },
  });
});
