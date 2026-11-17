import { Container, Trigger } from "@notation/factory";
import * as claude from "@notation/factory-claude";
import * as github from "@notation/factory-github";

const gh = github.Connection.get("notation-factory-test").channel({
  id: "issues",
});

const code = new github.Policy("code", {
  permissions: { contents: "write", pull_requests: "write" },
});

const dev = new Container("dev", {
  image: "./Dockerfile",
  runtimes: [claude.runtime],
  policies: [code],
});

const coder = new claude.Agent("coder", {
  model: "claude-opus-5-5",
  effort: "high",
});

new Trigger("mention", {
  event: gh.issueComment({
    actions: ["created", "edited"],
    mention: "@claude",
    from: github.collaborators(),
  }),
  worktree: (event) => `issue-${event.issue.number}`,
  agent: coder,
  container: dev,
});
