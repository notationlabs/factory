import { lightbox, secret } from "lightbox";
import * as claude from "@lightbox/claude";
import * as github from "@lightbox/github";
import * as railway from "@lightbox/railway";

export default lightbox(() => {
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
