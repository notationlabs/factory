import { lightbox, Workspace } from "lightbox";
import * as cloudflare from "@lightbox/cloudflare";
import * as github from "@lightbox/github";

export default lightbox(() => {
  const router = new cloudflare.Router({ id: "router", name: "acme-router" });

  const gh = new github.Connection({
    id: "gh",
    name: "acme-agents",
    org: "acme",
    router,
  });

  const issues = gh.channel({ name: "issues", scope: "acme/app" });

  issues.onIssueComment({
    actions: ["created", "edited"],
    mention: "@claude",
    from: github.collaborators(),
  });

  new Workspace({
    name: "issues",
    branch: "issue-{id}",
    base: "main",
    channel: issues,
  });
});
