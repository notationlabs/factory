import { lightbox, Workspace } from "lightbox";
import * as cloudflare from "@lightbox/cloudflare";
import * as github from "@lightbox/github";

export default lightbox(() => {
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
    config: { scope: "acme/app" },
  });

  issues.onIssueComment({
    actions: ["created", "edited"],
    mention: "@claude",
    from: github.collaborators(),
  });

  new Workspace({
    id: "issues",
    config: { branch: "issue-{id}", base: "main" },
    dependencies: { channel: issues },
  });
});
