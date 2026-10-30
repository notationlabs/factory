import { lightbox, secret } from "lightbox";
import * as claude from "@lightbox/claude";
import * as github from "@lightbox/github";
import * as railway from "@lightbox/railway";

export default lightbox(() => {
  const vault = new railway.Vault("vault");

  const router = new railway.Router("router", {
    project: "acme-agents",
    vault,
  });

  const gh = new github.Connection("gh", {
    name: "acme-agents",
    org: "acme",
    router,
  });

  new github.Connection("personal", {
    name: "alice-agents",
    router,
  });

  new github.CodeHost("github", {
    allow: [{ owner: "acme" }],
    connection: gh,
  });

  const claudeAccount = new claude.Account("claude", {
    auth: secret.env("CLAUDE_CODE_OAUTH_TOKEN"),
  });

  new railway.Deployer("deployer", {
    router,
    vault,
    accounts: [claudeAccount],
  });
});
