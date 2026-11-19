import * as claude from "@notation/factory-claude";
import * as cloudflare from "@notation/factory-cloudflare";
import * as droid from "@notation/factory-droid";
import * as github from "@notation/factory-github";
import { sources } from "@notation/std/resources";

const vault = new cloudflare.Vault("vault");

const router = new cloudflare.Router("router", { vault });

// Without an `org`, the App belongs to the GitHub account that creates it.
const gh = new github.Connection("gh", { router });

new github.CodeHost("github", {
  allow: [{ owner: "djgrant", repo: "notation-factory-test-outpost-1" }],
  connection: gh,
});

new github.OperatorAuth("operators", {
  users: ["djgrant"],
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

const droidKey = new sources.Env("factory-api-key", {
  config: { key: "FACTORY_API_KEY", track: "scrypt" },
});

const droidAccount = new droid.Account("droid", {
  auth: vault.secret({
    id: "factory-api-key",
    value: droidKey.credentials.value,
  }),
});

new cloudflare.Deployer("deployer", {
  router,
  vault,
  accounts: [claudeAccount, droidAccount],
  regions: ["WEUR"],
});
