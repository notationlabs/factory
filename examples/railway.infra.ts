import { factory } from "@notation/factory";
import * as claude from "@notation/factory-claude";
import * as github from "@notation/factory-github";
import * as railway from "@notation/factory-railway";
import { env } from "@notation/std/sources";

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
    auth: vault.secret({
      id: "claude-oauth-token",
      source: env,
      key: "CLAUDE_CODE_OAUTH_TOKEN",
    }),
  });

  new railway.Deployer("deployer", {
    router,
    vault,
    accounts: [claudeAccount],
  });
});
