import { Container, outpost, Policy, Trigger } from "lightbox";
import * as claude from "@lightbox/claude";
import * as github from "@lightbox/github";
import * as slack from "@lightbox/slack";

export default outpost(() => {
  const gh = github.Connection.get("acme-agents").channel({ id: "issues" });

  const ops = slack.Connection.get("acme-agents").channel({
    id: "ops",
    config: { scope: "#ops" },
  });

  const code = new github.Policy({
    id: "code",
    config: { permissions: { contents: "write", pull_requests: "write" } },
  });

  const shared = new github.Policy({
    id: "shared",
    config: { repo: "acme/shared", permissions: { contents: "read" } },
  });

  const custom = new Policy({
    id: "custom",
    config: { provider: "acme-auth", scopes: ["read"] },
  });

  const dev = new Container({
    id: "dev",
    config: {
      image: "./Dockerfile",
      runtimes: [claude.runtime],
      files: { "~/.npmrc": "./npmrc", "~/.config/app.json": { region: "eu" } },
    },
    dependencies: { policies: [code, shared, custom] },
  });

  const triage = new claude.Agent({
    id: "triage",
    config: { model: "claude-haiku-5-5", systemPrompt: "./prompts/triage.md" },
  });

  const coder = new claude.Agent({
    id: "coder",
    config: {
      model: "claude-opus-5-5",
      effort: "high",
      systemPrompt: "./prompts/coder.md",
      settings: { cleanupPeriodDays: 30 },
      files: { "~/.claude/CLAUDE.md": "./CLAUDE.md" },
    },
  });

  const branch = (event: { issue: { number: number } }) =>
    `issue-${event.issue.number}`;

  new Trigger({
    id: "on-open",
    dependencies: {
      event: gh.issue({ from: github.collaborators() }),
      agent: triage,
      container: dev,
      worktree: branch,
    },
  });

  new Trigger({
    id: "mention",
    dependencies: {
      event: gh.issueComment({
        actions: ["created", "edited"],
        mention: "@claude",
        from: github.collaborators(),
      }),
      agent: coder,
      container: dev,
      worktree: branch,
    },
  });

  new Trigger({
    id: "docs",
    config: { base: "docs" },
    dependencies: {
      event: gh.issueComment({
        mention: "@claude",
        labels: ["docs"],
        from: github.team("acme/docs"),
      }),
      agent: coder,
      container: dev,
      worktree: (event) => `docs/${event.issue.number}`,
    },
  });

  new Trigger({
    id: "slack",
    dependencies: {
      event: ops.mention("@claude", {
        from: [slack.group("eng"), slack.user("dan@acme.dev")],
      }),
      agent: coder,
      container: dev,
    },
  });
});
