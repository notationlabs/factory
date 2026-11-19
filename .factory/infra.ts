import { Container, Trigger } from "@notation/factory";
import * as claude from "@notation/factory-claude";
import * as cursor from "@notation/factory-cursor";
import * as droid from "@notation/factory-droid";
import * as github from "@notation/factory-github";

const gh = github.Connection.get("gh").channel({ id: "issues" });

const code = new github.Policy("code", {
  permissions: { contents: "write", pull_requests: "write" },
});

const dev = new Container("dev", {
  image: "./Dockerfile",
  runtimes: [claude.runtime, cursor.runtime, droid.runtime],
  policies: [code],
});

const claudeCoder = new claude.Agent("claude-coder", {
  model: "claude-opus-5-5",
  effort: "medium",
});

const droidCoder = new droid.Agent("droid-coder", {
  model: "claude-opus-5-5",
  effort: "medium",
});

const cursorCoder = new cursor.Agent("cursor-coder", {
  model: "grok-4.7-medium-fast",
});

new Trigger("claude-mention", {
  event: gh.issueComment({
    actions: ["created", "edited"],
    mention: "@claude",
    from: github.collaborators(),
  }),
  worktree: (event) => `issue-${event.issue.number}`,
  agent: claudeCoder,
  container: dev,
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

new Trigger("cursor-mention", {
  event: gh.issueComment({
    actions: ["created", "edited"],
    mention: "@cursor",
    from: github.collaborators(),
  }),
  worktree: (event) => `issue-${event.issue.number}`,
  agent: cursorCoder,
  container: dev,
});
