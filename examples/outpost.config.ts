import { Container, outpost, Policy, Trigger } from "@notation/factory";
import * as claude from "@notation/factory-claude";
import * as github from "@notation/factory-github";
import * as slack from "@notation/factory-slack";

export default outpost(() => {
  const gh = github.Connection.get("acme-agents").channel({ id: "issues" });

  const ops = slack.Connection.get("acme-agents").channel({
    id: "ops",
    scope: "#ops",
  });

  const code = new github.Policy("code", {
    permissions: { contents: "write", pull_requests: "write" },
  });

  const shared = new github.Policy("shared", {
    repo: "acme/shared",
    permissions: { contents: "read" },
  });

  const custom = new Policy("custom", {
    provider: "acme-auth",
    scopes: ["read"],
  });

  const dev = new Container("dev", {
    image: "./Dockerfile",
    runtimes: [claude.runtime],
    files: { "~/.npmrc": "./npmrc", "~/.config/app.json": { region: "eu" } },
    policies: [code, shared, custom],
  });

  const triage = new claude.Agent("triage", {
    model: "claude-haiku-5-5",
    systemPrompt: "./prompts/triage.md",
  });

  const coder = new claude.Agent("coder", {
    model: "claude-opus-5-5",
    effort: "high",
    systemPrompt: "./prompts/coder.md",
    settings: { cleanupPeriodDays: 30 },
    files: { "~/.claude/CLAUDE.md": "./CLAUDE.md" },
  });

  const branch = (event: { issue: { number: number } }) =>
    `issue-${event.issue.number}`;

  new Trigger("on-open", {
    event: gh.issue({ from: github.collaborators() }),
    worktree: branch,
    agent: triage,
    container: dev,
  });

  new Trigger("mention", {
    event: gh.issueComment({
      actions: ["created", "edited"],
      mention: "@claude",
      from: github.collaborators(),
    }),
    worktree: branch,
    agent: coder,
    container: dev,
  });

  new Trigger("docs", {
    event: gh.issueComment({
      mention: "@claude",
      labels: ["docs"],
      from: github.team("acme/docs"),
    }),
    worktree: (event) => `docs/${event.issue.number}`,
    base: "docs",
    agent: coder,
    container: dev,
  });

  new Trigger("slack", {
    event: ops.mention("@claude", {
      from: [slack.group("eng"), slack.user("dan@acme.dev")],
    }),
    agent: coder,
    container: dev,
  });
});
