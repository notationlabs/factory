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

const agents = { claude: claudeCoder, droid: droidCoder, cursor: cursorCoder };

for (const [name, agent] of Object.entries(agents)) {
  const mention = `@${name}`;
  const worktree = (event: { issue: { number: number } }) => `issue-${event.issue.number}`;
  new Trigger(`${name}-mention`, {
    event: gh.issueComment({ actions: ["created", "edited"], mention, from: github.collaborators() }),
    worktree,
    agent,
    container: dev,
  });
  new Trigger(`${name}-issue`, {
    event: gh.issue({ actions: ["opened", "edited"], mention, from: github.collaborators() }),
    worktree,
    agent,
    container: dev,
  });
}
