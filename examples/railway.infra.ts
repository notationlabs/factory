import * as claude from "@notation/factory-claude";
import * as github from "@notation/factory-github";
import * as railway from "@notation/factory-railway";
import { sources } from "@notation/std/resources";

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

const claudeToken = new sources.Env("claude-oauth-token", {
  config: { key: "CLAUDE_CODE_OAUTH_TOKEN", track: "scrypt" },
});

const claudeAccount = new claude.Account("claude", {
  auth: vault.secret({
    id: "claude-oauth-token",
    value: claudeToken.credentials.value,
  }),
});

new railway.Deployer("deployer", {
  router,
  vault,
  accounts: [claudeAccount],
});
