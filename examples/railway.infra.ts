import { lightbox, secret } from "lightbox";
import * as claude from "@lightbox/claude";
import * as github from "@lightbox/github";
import * as railway from "@lightbox/railway";

export default lightbox(() => {
  const vault = new railway.Vault({ id: "vault" });

  const router = new railway.Router({
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

  new github.Connection({
    id: "personal",
    config: { name: "alice-agents" },
    dependencies: { router },
  });

  const claudeAccount = new claude.Account({
    id: "claude",
    config: { auth: secret.env("CLAUDE_CODE_OAUTH_TOKEN") },
  });

  new railway.Deployer({
    id: "deployer",
    dependencies: { router, accounts: [claudeAccount] },
  });
});
