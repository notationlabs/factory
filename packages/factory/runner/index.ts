import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, join, normalize } from "node:path";
import type { Relay, Run } from "../router/run.ts";

const PORT = Number(process.env.FACTORY_RUNNER_PORT ?? 8080);
const DATA = process.env.FACTORY_DATA ?? "/data";
const HOME = homedir();

/** The longest a run's agent may take. */
const RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/** The most bytes of an agent's output kept. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const log = (entry: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));

type Result = { code: number | null; stdout: string; stderr: string };

/** Runs `command`, and resolves with its exit code and output. Rejects only if it can't start. */
const exec = (
  command: string,
  args: string[],
  { cwd, env, timeout }: { cwd?: string; env?: Record<string, string | undefined>; timeout?: number } = {},
) =>
  new Promise<Result>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk;
    });
    const timer = timeout ? setTimeout(() => child.kill("SIGTERM"), timeout) : undefined;
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

/** Runs git, and returns its output. Throws with its stderr if it fails. */
const git = async (args: string[], options: { cwd?: string; token?: string } = {}) => {
  // The token goes in a header for this command only, so the agent can't
  // read it from the repo's config.
  const auth = options.token
    ? ["-c", `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${options.token}`).toString("base64")}`]
    : [];
  const result = await exec("git", [...auth, ...args], { cwd: options.cwd });
  if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
};

/** Calls `task` once every earlier call with the same key has finished. */
const serial = () => {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.catch(() => {});
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return next;
  };
};

/** Fetches into one repo's bare clone at a time. */
const repoLock = serial();
/** Runs one run at a time in each worktree. */
const worktreeLock = serial();

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");

/**
 * Updates the repo's bare clone under `/data/repos`, cloning it the first
 * time. Its remote branches are `origin/*`. Returns its path and the
 * default branch.
 */
const fetchRepo = (run: Run) =>
  repoLock(run.repo, async () => {
    const path = join(DATA, "repos", `${slug(run.repo)}.git`);
    const url = `https://github.com/${run.repo}.git`;
    if (!existsSync(path)) {
      await mkdir(dirname(path), { recursive: true });
      await git(["clone", "--bare", url, path], { token: run.cloneToken });
      await git(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], { cwd: path });
    }
    await git(["fetch", "--prune", "origin"], { cwd: path, token: run.cloneToken });
    const head = await git(["symbolic-ref", "--short", "HEAD"], { cwd: path });
    return { path, defaultBranch: head };
  });

const hasRef = async (repo: string, ref: string) =>
  (await exec("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: repo })).code === 0;

/**
 * Checks out the run's worktree, if it isn't checked out yet:
 * - a branch worktree under `/data/worktrees`, on `origin/<branch>` if it
 *   exists, or else cut from `base` or the default branch
 * - a scratch worktree per conversation under `/data/scratch`, detached at
 *   the default branch
 * A worktree that exists already keeps its work.
 */
const checkout = async (run: Run, repo: { path: string; defaultBranch: string }) => {
  if (run.worktree) {
    const { branch, base } = run.worktree;
    const path = join(DATA, "worktrees", slug(run.repo), branch);
    if (existsSync(path)) return path;
    const remote = `origin/${branch}`;
    const exists = await hasRef(repo.path, `refs/remotes/${remote}`);
    const start = exists ? remote : `origin/${base ?? repo.defaultBranch}`;
    await git(["worktree", "add", "--force", "-B", branch, path, start], { cwd: repo.path });
    if (exists) await git(["branch", `--set-upstream-to=${remote}`, branch], { cwd: path });
    return path;
  }
  const path = join(DATA, "scratch", slug(run.conversation.id));
  if (existsSync(path)) return path;
  await git(["worktree", "add", "--force", "--detach", path, `origin/${repo.defaultBranch}`], { cwd: repo.path });
  return path;
};

/** A path under `root` for `relative`, which mustn't leave it. */
const inside = (root: string, relative: string) => {
  const path = normalize(join(root, relative));
  if (path !== root && !path.startsWith(`${root}/`)) throw new Error(`${relative} is outside ${root}.`);
  return path;
};

/** Writes the container's startup files to the home directory: a string is a file in `.factory/`, an object is written as JSON. */
const writeFiles = async (run: Run, worktree: string) => {
  for (const [target, source] of Object.entries(run.files)) {
    if (!target.startsWith("~/")) throw new Error(`The container file ${target} isn't under ~/.`);
    const path = inside(HOME, target.slice(2));
    const content =
      typeof source === "string"
        ? await readFile(inside(join(worktree, ".factory"), source))
        : `${JSON.stringify(source, null, 2)}\n`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { mode: 0o600 });
  }
};

/** Writes each policy's token to `/data/github/<policy>`, and returns the token of the run's repo, for `gh` and git pushes. */
const writeTokens = async (run: Run) => {
  const dir = join(DATA, "github");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const { policy, token } of run.tokens) await writeFile(join(dir, slug(policy)), token, { mode: 0o600 });
  return run.tokens.find((t) => t.repo.toLowerCase() === run.repo.toLowerCase())?.token;
};

type Session = { id: string; cwd: string };

const sessionPath = (run: Run) => join(DATA, "sessions", `${slug(run.conversation.id)}.json`);

const readSession = async (run: Run): Promise<Session | undefined> => {
  try {
    return JSON.parse(await readFile(sessionPath(run), "utf8")) as Session;
  } catch {
    return undefined;
  }
};

/**
 * Runs Claude Code in `cwd` with the run's prompt, and returns its final
 * message. It resumes the conversation's session if the session ran in the
 * same worktree.
 */
const claude = async (run: Run, cwd: string, token: string | undefined) => {
  const { agent } = run;
  const args = ["-p", run.conversation.prompt, "--output-format", "json", "--dangerously-skip-permissions"];
  if (typeof agent.model === "string") args.push("--model", agent.model);
  if (typeof agent.effort === "string") args.push("--effort", agent.effort);
  if (typeof agent.systemPrompt === "string") {
    args.push("--append-system-prompt", await readFile(inside(join(cwd, ".factory"), agent.systemPrompt), "utf8"));
  }
  if (agent.settings) args.push("--settings", JSON.stringify(agent.settings));
  const session = await readSession(run);
  if (session?.cwd === cwd) args.push("--resume", session.id);

  const result = await exec("claude", args, {
    cwd,
    env: { ...process.env, ...(token && { GH_TOKEN: token }) },
    timeout: RUN_TIMEOUT_MS,
  });
  let output: { result?: string; is_error?: boolean; session_id?: string } | undefined;
  try {
    output = JSON.parse(result.stdout);
  } catch {}
  if (output?.session_id) {
    await mkdir(dirname(sessionPath(run)), { recursive: true });
    await writeFile(sessionPath(run), JSON.stringify({ id: output.session_id, cwd } satisfies Session));
  }
  if (result.code !== 0 || !output || output.is_error) {
    const detail = output?.result ?? (result.stderr.trim() || result.stdout.trim()).slice(-4000);
    throw new Error(`Claude Code exited with code ${result.code}: ${detail}`);
  }
  return output.result ?? "";
};

const relay = async (run: Run, text: string) => {
  const body: Relay = { ticket: run.reply.ticket, signature: run.reply.signature, text };
  const response = await fetch(run.reply.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`The router refused the reply with status ${response.status}: ${await response.text()}`);
};

let active = 0;

/**
 * Runs one run:
 * 1. Updates the repo's clone, and checks out the run's worktree.
 * 2. Writes the container's files and the policies' tokens.
 * 3. Runs the agent in the worktree.
 * 4. Posts the agent's final message, or the error, to the conversation.
 */
const execute = async (run: Run) => {
  const started = Date.now();
  log({ run: run.id, repo: run.repo, trigger: run.trigger, worktree: run.worktree?.branch ?? "scratch", state: "started" });
  let text: string;
  try {
    if (run.agent.runtime !== "claude") throw new Error(`The runner can't run agents of the runtime ${run.agent.runtime}.`);
    const repo = await fetchRepo(run);
    const worktree = await checkout(run, repo);
    await writeFiles(run, worktree);
    const token = await writeTokens(run);
    text = await claude(run, worktree, token);
    log({ run: run.id, state: "finished", ms: Date.now() - started });
  } catch (error) {
    log({ run: run.id, state: "failed", error: message(error), ms: Date.now() - started });
    text = `The run failed: ${message(error)}`;
  }
  try {
    await relay(run, text || "(The agent finished with no message.)");
  } catch (error) {
    log({ run: run.id, state: "relay failed", error: message(error) });
  }
};

const enqueue = (run: Run) => {
  active++;
  const key = run.worktree ? `branch:${run.repo}:${run.worktree.branch}` : `scratch:${run.conversation.id}`;
  void worktreeLock(key, () => execute(run)).finally(() => active--);
};

const send = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

/** Git signs commits as the hub, and pushes with the token in `GH_TOKEN`. Each write locks the config file, so they run in turn. */
const configureGit = async () => {
  await git(["config", "--global", "user.name", "Notation Factory"]);
  await git(["config", "--global", "user.email", "notation-factory@users.noreply.github.com"]);
  await git([
    "config",
    "--global",
    "credential.https://github.com.helper",
    '!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f',
  ]);
};

/**
 * The runner's routes, on the port the provider routes to:
 * - `POST /runs` queues a run, and answers 202
 * - `GET /status` answers how many runs are running or queued
 */
const server = createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url ?? "/", "http://runner");
    if (request.method === "POST" && pathname === "/runs") {
      const run = JSON.parse(await readBody(request)) as Run;
      if (typeof run?.id !== "string" || typeof run.repo !== "string" || !run.reply) {
        return send(response, 400, { error: "not a run" });
      }
      enqueue(run);
      return send(response, 202, { queued: run.id });
    }
    if (request.method === "GET" && pathname === "/status") return send(response, 200, { active });
    return send(response, 404, { error: "not found" });
  } catch (error) {
    send(response, 500, { error: message(error) });
  }
});

await configureGit();
server.listen(PORT, () => log({ state: "listening", port: PORT }));
