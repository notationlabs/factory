import { Container, Trigger } from "@notation/factory";
import * as claude from "@notation/factory-claude";
import * as droid from "@notation/factory-droid";
import * as github from "@notation/factory-github";

const gh = github.Connection.get("gh").channel({
  id: "issues",
});

const code = new github.Policy("code", {
  permissions: { contents: "write", pull_requests: "write" },
});

const dev = new Container("dev", {
  image: "./Dockerfile",
  runtimes: [claude.runtime, droid.runtime],
  policies: [code],
});

const coder = new claude.Agent("coder", {
  model: "claude-opus-5-5",
  effort: "low",
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

const droidCoder = new droid.Agent("droid-coder", {
  model: "claude-opus-5-5",
  effort: "low",
});

new Trigger("droid-mention", {
  event: gh.issueComment({
    actions: ["created", "edited"],
    mention: "@droid",
    from: github.collaborators(),
  }),
  worktree: (event) => `issue-${event.issue.number}`,
  agent: droidCoder,
  container: dev,
});
