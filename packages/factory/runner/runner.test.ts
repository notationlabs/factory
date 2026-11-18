import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Relay, Run, TokenRequest } from "../router/run.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-runner-")));
const bin = join(root, "bin");
const data = join(root, "data");
const home = join(root, "home");
const calls = join(root, "calls");
const port = 40000 + Math.floor(Math.random() * 20000);

const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();

// A fake Claude Code: it records how it was called and the token that gh
// gets, and writes a transcript for a session named after its working
// directory. It fails, edits the worktree, or waits for the runner to
// refresh its tokens, when the prompt says so.
const FAKE_CLAUDE = `#!/bin/sh
prompt="$2"
case "$prompt" in
  wait*) sleep 1 ;;
esac
printf '%s\\n' "$(pwd)" "$(gh)" "$(printf '%s' "$*" | tr '\\n' ' ')" >> "${calls}"
session="s-$(basename "$(pwd)")"
mkdir -p "$HOME/.claude/projects/-p-$(basename "$(pwd)")"
echo "$prompt" >> "$HOME/.claude/projects/-p-$(basename "$(pwd)")/$session.jsonl"
case "$prompt" in
  fail*) echo "{\\"is_error\\":true,\\"result\\":\\"it broke\\",\\"session_id\\":\\"$session\\"}"; exit 1 ;;
  edit*)
    echo committed > committed.txt
    git add committed.txt
    git commit -q -m "local work"
    echo draft > notes.txt
    rm README.md ;;
  wait*) printf 'protocol=https\\nhost=github.com\\n\\n' | git credential fill | grep password= >> "${calls}" ;;
esac
echo "{\\"result\\":\\"done\\",\\"session_id\\":\\"$session\\"}"
`;

/** A fake Droid: like the fake Claude Code, but for droid's CLI. */
const FAKE_DROID = `#!/bin/sh
prompt="$2"
printf '%s\\n' "$(pwd)" "$(gh)" "$(printf '%s' "$*" | tr '\\n' ' ')" >> "${calls}"
session="s-$(basename "$(pwd)")"
mkdir -p "$HOME/.factory/sessions/-p-$(basename "$(pwd)")"
echo "$prompt" >> "$HOME/.factory/sessions/-p-$(basename "$(pwd)")/$session.jsonl"
echo "{\\"result\\":\\"done\\",\\"session_id\\":\\"$session\\"}"
`;

/** A fake gh, which prints the token it gets. */
const FAKE_GH = `#!/bin/sh
echo "$GH_TOKEN"
`;

const replies: Relay[] = [];
/** The token that the fake router mints when the runner asks for new tokens. */
let freshToken = "push-token";
const tokenRequests: TokenRequest[] = [];
let waiting: (() => void) | undefined;
let server: Server;
let runner: ChildProcess;
/** The state store's objects, by key. */
const state = new Map<string, Buffer>();

const nextReply = () =>
  new Promise<Relay>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no reply")), 20_000);
    const check = () => {
      const reply = replies.shift();
      if (!reply) return void (waiting = check);
      clearTimeout(timer);
      resolve(reply);
    };
    check();
  });

before(async () => {
  mkdirSync(bin);
  mkdirSync(home);
  writeFileSync(join(bin, "claude"), FAKE_CLAUDE, { mode: 0o755 });
  writeFileSync(join(bin, "droid"), FAKE_DROID, { mode: 0o755 });
  writeFileSync(join(bin, "gh"), FAKE_GH, { mode: 0o755 });

  const work = join(root, "work");
  mkdirSync(join(work, ".factory"), { recursive: true });
  writeFileSync(join(work, ".factory", "prompt.md"), "Be brief.");
  writeFileSync(join(work, ".factory", "npmrc"), "registry=x");
  writeFileSync(join(work, "README.md"), "# api\n");
  sh(root, "init", "-q", "-b", "main", work);
  sh(work, "add", ".");
  sh(work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  mkdirSync(join(root, "remotes", "acme"), { recursive: true });
  sh(root, "clone", "-q", "--bare", work, join(root, "remotes", "acme", "api.git"));

  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const { pathname } = new URL(request.url!, "http://test");
      if (pathname.startsWith("/state/")) {
        const key = pathname.slice("/state/".length);
        if (request.method === "PUT") {
          state.set(key, Buffer.concat(chunks));
          return response.end();
        }
        const object = state.get(key);
        response.statusCode = object ? 200 : 404;
        return response.end(object);
      }
      if (pathname === "/tokens") {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as TokenRequest;
        tokenRequests.push(body);
        return response.end(JSON.stringify([{ policy: "code", repo: body.ticket.repo, token: freshToken }]));
      }
      replies.push(JSON.parse(Buffer.concat(chunks).toString()));
      waiting?.();
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  await startRunner();
});

after(() => {
  runner?.kill();
  server?.close();
  rmSync(root, { recursive: true, force: true });
});

const serverUrl = () => `http://127.0.0.1:${(server.address() as { port: number }).port}`;

const startRunner = async () => {
  runner = spawn(process.execPath, [join(import.meta.dirname, "index.ts")], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      HOME: home,
      FACTORY_DATA: data,
      FACTORY_RUNNER_PORT: String(port),
      FACTORY_STATE_URL: `${serverUrl()}/state`,
      FACTORY_TOKEN_REFRESH_MS: "300",
      // Clones of github.com come from the local remotes.
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${join(root, "remotes")}/.insteadOf`,
      GIT_CONFIG_VALUE_0: "https://github.com/",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    runner.stdout!.on("data", (chunk) => String(chunk).includes("listening") && resolve());
    runner.once("exit", (code) => reject(new Error(`The runner exited with code ${code}.`)));
  });
};

/** Stops the runner, and deletes what a container loses when it sleeps. */
const sleepContainer = async () => {
  const exited = new Promise((resolve) => runner.once("exit", resolve));
  runner.kill("SIGTERM");
  // An exit code, not a signal, shows that the runner handled SIGTERM. As
  // a container's PID 1, it would ignore it otherwise.
  assert.equal(await exited, 0);
  rmSync(data, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home);
};

const run = (over: Partial<Run> = {}): Run => ({
  id: crypto.randomUUID(),
  repo: "acme/api",
  trigger: "mention",
  container: "dev",
  runtimes: ["claude"],
  files: { "~/.npmrc": "npmrc", "~/.config/app.json": { region: "eu" } },
  agent: { id: "coder", runtime: "claude", model: "claude-opus-5-5", effort: "high", systemPrompt: "prompt.md" },
  conversation: { id: "github:acme/api#1", prompt: "fix it" },
  worktree: { branch: "issue-1" },
  cloneToken: "clone-token",
  tokens: [{ policy: "code", repo: "acme/api", token: "push-token" }],
  refresh: {
    url: `${serverUrl()}/tokens`,
    ticket: { repo: "acme/api", container: "dev", expires: Date.now() + 60_000 },
    signature: "token-sig",
  },
  reply: {
    url: `${serverUrl()}/relay`,
    ticket: { connection: "github/x", thread: { issue: 1 }, expires: Date.now() + 60_000 },
    signature: "sig",
  },
  ...over,
});

const post = (body: Run) =>
  fetch(`http://127.0.0.1:${port}/runs`, { method: "POST", body: JSON.stringify(body) });

const lastCall = () => readFileSync(calls, "utf8").trim().split("\n").slice(-3);

test("runs the agent on its branch's worktree, and replies with its final message", async () => {
  const response = await post(run());
  assert.equal(response.status, 202);
  const reply = await nextReply();
  assert.equal(reply.text, "done");
  assert.deepEqual(reply.ticket.thread, { issue: 1 });
  assert.equal(reply.signature, "sig");

  const worktree = join(data, "worktrees", "acme-api", "issue-1");
  const [cwd, token, args] = lastCall();
  assert.equal(cwd, worktree);
  assert.equal(token, "push-token");
  // The runner's prompt comes first, then the agent's own.
  assert.match(args!, /--model claude-opus-5-5 --effort high --append-system-prompt You're running headless, .* Be brief\./);
  assert.equal(sh(worktree, "branch", "--show-current"), "issue-1");
  assert.equal(readFileSync(join(home, ".npmrc"), "utf8"), "registry=x");
  assert.deepEqual(JSON.parse(readFileSync(join(home, ".config", "app.json"), "utf8")), { region: "eu" });
  assert.equal(readFileSync(join(data, "github", "code"), "utf8"), "push-token");
  // The clone token isn't kept in the repo's config.
  assert.doesNotMatch(readFileSync(join(data, "repos", "acme-api.git", "config"), "utf8"), /clone-token|extraHeader/i);
});

test("a later run in the same conversation and worktree resumes its session", async () => {
  await post(run());
  await nextReply();
  assert.match(lastCall()[2]!, /--resume s-issue-1/);
});

test("a droid run invokes droid exec, skipping permissions without an autonomy level", async () => {
  await post(
    run({
      runtimes: ["droid"],
      agent: { id: "coder", runtime: "droid", model: "claude-opus-5-5", effort: "medium", systemPrompt: "prompt.md" },
      conversation: { id: "github:acme/api#20", prompt: "droid it" },
    }),
  );
  assert.equal((await nextReply()).text, "done");
  const [cwd, token, args] = lastCall();
  assert.equal(cwd, join(data, "worktrees", "acme-api", "issue-1"));
  assert.equal(token, "push-token");
  assert.match(
    args!,
    /^exec droid it --output-format json --skip-permissions-unsafe --model claude-opus-5-5 --reasoning-effort medium --append-system-prompt You're running headless, .* Be brief\.$/,
  );
});

test("a droid agent with autonomy runs with --auto, and resumes its session", async () => {
  const agent = { id: "coder", runtime: "droid", autonomy: "high", settings: { hooks: { hooksDisabled: true } } };
  const conversation = { id: "github:acme/api#21", prompt: "droid it" };
  await post(run({ runtimes: ["droid"], agent, conversation }));
  assert.equal((await nextReply()).text, "done");
  assert.match(
    lastCall()[2]!,
    /^exec droid it --output-format json --auto high --append-system-prompt You're running headless, .*Link the pull request in your reply\. --settings \S*agents\/coder\/settings\.json$/,
  );

  await post(run({ runtimes: ["droid"], agent, conversation: { ...conversation, prompt: "carry on" } }));
  assert.equal((await nextReply()).text, "done");
  assert.match(lastCall()[2]!, /--session-id s-issue-1$/);
});

test("agents in the same conversation and worktree keep their own sessions", async () => {
  const conversation = { id: "github:acme/api#22", prompt: "go" };
  await post(run({ conversation }));
  assert.equal((await nextReply()).text, "done");
  const droidAgent = { id: "droid-coder", runtime: "droid" };
  await post(run({ runtimes: ["droid"], agent: droidAgent, conversation }));
  assert.equal((await nextReply()).text, "done");
  assert.doesNotMatch(lastCall()[2]!, /--session-id/);

  await post(run({ conversation: { ...conversation, prompt: "carry on" } }));
  assert.equal((await nextReply()).text, "done");
  assert.match(lastCall()[2]!, /--resume s-issue-1$/);
  await post(run({ runtimes: ["droid"], agent: droidAgent, conversation: { ...conversation, prompt: "carry on" } }));
  assert.equal((await nextReply()).text, "done");
  assert.match(lastCall()[2]!, /--session-id s-issue-1$/);
});

test("a run with no branch gets a scratch worktree for its conversation", async () => {
  await post(run({ worktree: undefined, conversation: { id: "github:acme/api#2", prompt: "look" } }));
  assert.equal((await nextReply()).text, "done");
  const scratch = join(data, "scratch", "github-acme-api-2");
  assert.equal(lastCall()[0], scratch);
  assert.ok(existsSync(join(scratch, ".factory", "prompt.md")));
});

test("a failed run replies with the error", async () => {
  await post(run({ conversation: { id: "github:acme/api#3", prompt: "fail now" } }));
  assert.match((await nextReply()).text, /The run failed: Claude Code exited with code 1: it broke/);
});

test("after the container sleeps, a run restores its worktree and its conversation's session", async () => {
  const conversation = { id: "github:acme/api#9", prompt: "edit the code" };
  await post(run({ worktree: { branch: "issue-9" }, conversation }));
  assert.equal((await nextReply()).text, "done");
  assert.ok(state.has("worktrees/issue-9.bundle"));
  assert.ok(state.has("sessions/github-acme-api-9/coder.json"));

  await sleepContainer();
  await startRunner();

  await post(run({ worktree: { branch: "issue-9" }, conversation: { ...conversation, prompt: "carry on" } }));
  assert.equal((await nextReply()).text, "done");
  const worktree = join(data, "worktrees", "acme-api", "issue-9");
  assert.match(lastCall()[2]!, /--resume s-issue-9/);
  assert.equal(sh(worktree, "branch", "--show-current"), "issue-9");
  assert.equal(sh(worktree, "log", "-1", "--format=%s"), "local work");
  assert.equal(readFileSync(join(worktree, "notes.txt"), "utf8"), "draft\n");
  assert.equal(sh(worktree, "status", "--porcelain"), "D README.md\n?? notes.txt");
  const transcript = join(home, ".claude", "projects", "-p-issue-9", "s-issue-9.jsonl");
  assert.equal(readFileSync(transcript, "utf8"), "edit the code\ncarry on\n");
});

test("a snapshot that can't be restored leaves a note, and the run starts from the remote", async () => {
  state.set("worktrees/issue-10.bundle", Buffer.from("not a bundle"));
  await post(run({ worktree: { branch: "issue-10" }, conversation: { id: "github:acme/api#10", prompt: "go" } }));
  const reply = await nextReply();
  assert.match(reply.text, /^done\n\n> Factory couldn't restore this worktree's saved state/);
  assert.equal(sh(join(data, "worktrees", "acme-api", "issue-10"), "log", "-1", "--format=%s"), "init");
});

test("during a long run, the runner refreshes the tokens that gh and git read", async () => {
  freshToken = "fresh-token";
  tokenRequests.length = 0;
  await post(run({ conversation: { id: "github:acme/api#11", prompt: "wait for it" } }));
  assert.equal((await nextReply()).text, "done");
  const lines = readFileSync(calls, "utf8").trim().split("\n").slice(-4);
  assert.equal(lines[1], "fresh-token");
  assert.equal(lines[3], "password=fresh-token");
  const { ticket, signature } = tokenRequests[0]!;
  assert.deepEqual([ticket.repo, ticket.container, signature], ["acme/api", "dev", "token-sig"]);
  assert.equal(readFileSync(join(data, "github", "code"), "utf8"), "fresh-token");
});

test("status counts the runs that are running or queued", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/status`);
  assert.deepEqual(await response.json(), { active: 0 });
});
