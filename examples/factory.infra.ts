import { factory, Workspace } from "factory";
import * as cloudflare from "@factory/cloudflare";
import * as github from "@factory/github";

export default factory(() => {
  const router = new cloudflare.Router({
    id: "router",
    config: { name: "acme-router" },
  });

  const gh = new github.Connection({
    id: "gh",
    config: { name: "acme-agents", org: "acme" },
    dependencies: { router },
  });

  const issues = gh.channel({
    id: "issues",
    config: { name: "issues", scope: "acme/app" },
  });

  issues.onIssueComment({
    actions: ["created", "edited"],
    mention: "@claude",
    from: github.collaborators(),
  });

  new Workspace({
    id: "issues",
    config: { name: "issues", branch: "issue-{id}", base: "main" },
    dependencies: { channel: issues },
  });
});
