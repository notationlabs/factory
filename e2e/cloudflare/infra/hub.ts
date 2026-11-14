import * as claude from "@notation/factory-claude";
import * as cloudflare from "@notation/factory-cloudflare";
import { env } from "@notation/std/sources";

const vault = new cloudflare.Vault("vault");

const router = new cloudflare.Router("router", {
  project: "factory-e2e",
  vault,
});

const claudeAccount = new claude.Account("claude", {
  auth: vault.secret({
    id: "claude-oauth-token",
    source: env,
    key: "CLAUDE_CODE_OAUTH_TOKEN",
  }),
});

new cloudflare.Deployer("deployer", {
  router,
  vault,
  accounts: [claudeAccount],
});
