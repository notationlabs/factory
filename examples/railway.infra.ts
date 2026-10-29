import { factory, secret } from "factory";
import * as claude from "@factory/claude";
import * as github from "@factory/github";
import * as railway from "@factory/railway";

export default factory(() => {
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
    accounts: [claudeAccount],
  });
});
