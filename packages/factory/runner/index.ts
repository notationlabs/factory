import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";
import type { Relay, Run, TokenRequest, Tokens } from "../router/run.ts";

const PORT = Number(process.env.FACTORY_RUNNER_PORT ?? 8080);
const DATA = process.env.FACTORY_DATA ?? "/data";
const HOME = homedir();
/** The container's state store, which outlives the container. The provider answers this host. */
const STATE_URL = process.env.FACTORY_STATE_URL ?? "http://state.factory";

/** How often a run asks the router for new tokens. GitHub's installation tokens last an hour. */
const TOKEN_REFRESH_MS = Number(process.env.FACTORY_TOKEN_REFRESH_MS ?? 30 * 60 * 1000);

/** Where the runner puts a `gh` that reads its token from `FACTORY_TOKEN_FILE`. */
const BIN = join(DATA, "bin");

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
const git = async (
  args: string[],
  options: { cwd?: string; token?: string; env?: Record<string, string | undefined> } = {},
) => {
  // The token goes in a header for this command only, so the agent can't
  // read it from the repo's config.
  const auth = options.token
    ? ["-c", `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${options.token}`).toString("base64")}`]
    : [];
  const result = await exec("git", [...auth, ...args], {
    cwd: options.cwd,
    env: options.env && { ...process.env, ...options.env },
  });
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

/** Reads an object from the state store, or returns undefined if there is none. */
const getState = async (key: string) => {
  const response = await fetch(`${STATE_URL}/${key}`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`The state store refused to read ${key} with status ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
};

const putState = async (key: string, body: Buffer) => {
  const response = await fetch(`${STATE_URL}/${key}`, { method: "PUT", body: new Uint8Array(body) });
  if (!response.ok) throw new Error(`The state store refused to write ${key} with status ${response.status}.`);
};

const withTempDir = async <T>(task: (dir: string) => Promise<T>) => {
  const dir = await mkdtemp(join(tmpdir(), "factory-"));
  try {
    return await task(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/**
 * A run's worktree: a branch worktree under `/data/worktrees`, or a scratch
 * worktree per conversation under `/data/scratch`. `key` is its snapshot in
 * the state store, and `ref` the snapshot's ref in the repo's clone.
 */
type Worktree = { path: string; branch?: string; key: string; ref: string };

const worktreeOf = (run: Run): Worktree => {
  if (run.worktree) {
    const { branch } = run.worktree;
    return {
      path: join(DATA, "worktrees", slug(run.repo), branch),
      branch,
      key: `worktrees/${encodeURIComponent(branch)}.bundle`,
      ref: `refs/factory/worktrees/${branch}`,
    };
  }
  const name = slug(run.conversation.id);
  return { path: join(DATA, "scratch", name), key: `scratch/${name}.bundle`, ref: `refs/factory/scratch/${name}` };
};

/**
 * Saves the worktree to the state store, as a git bundle of one commit on
 * top of its HEAD. The commit holds every file that git doesn't ignore,
 * committed or not. The bundle leaves out what `origin` already has.
 */
const saveWorktree = (worktree: Worktree) =>
  withTempDir(async (dir) => {
    const cwd = worktree.path;
    // A copy of the worktree's index, so git only reads the files that changed.
    const index = join(dir, "index");
    await copyFile(resolve(cwd, await git(["rev-parse", "--git-path", "index"], { cwd })), index);
    await git(["add", "--all"], { cwd, env: { GIT_INDEX_FILE: index } });
    const tree = await git(["write-tree"], { cwd, env: { GIT_INDEX_FILE: index } });
    const commit = await git(["commit-tree", tree, "-p", "HEAD", "-m", "Factory snapshot"], { cwd });
    await git(["update-ref", worktree.ref, commit], { cwd });
    const bundle = join(dir, "bundle");
    await git(["bundle", "create", "--quiet", bundle, worktree.ref, "--not", "--remotes=origin"], { cwd });
    await putState(worktree.key, await readFile(bundle));
  });

/**
 * Checks out the worktree from its snapshot, if the state store has one:
 * HEAD at the snapshot's parent, and the files as the snapshot has them,
 * not staged. Returns whether there was a snapshot.
 */
const restoreWorktree = (run: Run, worktree: Worktree, repo: { path: string }) =>
  withTempDir(async (dir) => {
    const bundle = await getState(worktree.key);
    if (!bundle) return false;
    await writeFile(join(dir, "bundle"), bundle);
    await repoLock(run.repo, () =>
      git(["fetch", "--quiet", join(dir, "bundle"), `+${worktree.ref}:${worktree.ref}`], { cwd: repo.path }),
    );
    const head = `${worktree.ref}^`;
    const target = worktree.branch ? ["-B", worktree.branch] : ["--detach"];
    await git(["worktree", "add", "--force", ...target, worktree.path, head], { cwd: repo.path });
    await git(["read-tree", "-u", "--reset", worktree.ref], { cwd: worktree.path });
    await git(["reset", "--quiet"], { cwd: worktree.path });
    return true;
  });

/**
 * Checks out the run's worktree, if it isn't checked out yet. It restores
 * the worktree's snapshot if there is one. Otherwise a branch worktree
 * starts at `origin/<branch>` if it exists, or else is cut from `base` or
 * the default branch, and a scratch worktree is detached at the default
 * branch. A worktree that exists already keeps its work. Adds to `notes` if
 * the snapshot can't be restored.
 */
const checkout = async (run: Run, repo: { path: string; defaultBranch: string }, worktree: Worktree, notes: string[]) => {
  const { path, branch } = worktree;
  if (existsSync(path)) return;
  try {
    if (await restoreWorktree(run, worktree, repo)) {
      if (branch && (await hasRef(repo.path, `refs/remotes/origin/${branch}`))) {
        await git(["branch", `--set-upstream-to=origin/${branch}`, branch], { cwd: path });
      }
      return;
    }
  } catch (error) {
    notes.push(`Factory couldn't restore this worktree's saved state, so the run started from the remote: ${message(error)}`);
    await rm(path, { recursive: true, force: true });
    await git(["worktree", "prune"], { cwd: repo.path });
  }
  if (branch) {
    const remote = `origin/${branch}`;
    const exists = await hasRef(repo.path, `refs/remotes/${remote}`);
    const start = exists ? remote : `origin/${run.worktree?.base ?? repo.defaultBranch}`;
    await git(["worktree", "add", "--force", "-B", branch, path, start], { cwd: repo.path });
    if (exists) await git(["branch", `--set-upstream-to=${remote}`, branch], { cwd: path });
    return;
  }
  await git(["worktree", "add", "--force", "--detach", path, `origin/${repo.defaultBranch}`], { cwd: repo.path });
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

const TOKENS = join(DATA, "github");

/**
 * Writes each policy's token to `/data/github/<policy>`. Each file is
 * replaced whole, so a reader never sees half a token.
 */
const writeTokens = async (tokens: Tokens) => {
  await mkdir(TOKENS, { recursive: true, mode: 0o700 });
  for (const { policy, token } of tokens) {
    const path = join(TOKENS, slug(policy));
    await writeFile(`${path}.new`, token, { mode: 0o600 });
    await rename(`${path}.new`, path);
  }
};

/** The token file of the run's repo, which `gh` and git pushes use. */
const tokenFile = (run: Run) => {
  const found = run.tokens.find((t) => t.repo.toLowerCase() === run.repo.toLowerCase());
  return found && join(TOKENS, slug(found.policy));
};

/** Asks the router for new tokens, and writes them. */
const refreshTokens = async (run: Run) => {
  const body: TokenRequest = { ticket: run.refresh.ticket, signature: run.refresh.signature };
  const response = await fetch(run.refresh.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`The router refused new tokens with status ${response.status}: ${await response.text()}`);
  await writeTokens((await response.json()) as Tokens);
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

/** Where Claude Code keeps its sessions' transcripts, in a directory per working directory. */
const TRANSCRIPTS = join(HOME, ".claude", "projects");

const sessionKey = (run: Run) => `sessions/${slug(run.conversation.id)}`;

/**
 * Saves the conversation's session to the state store: its transcript
 * files, as a tarball of their paths under `~/.claude/projects`, and then
 * the session's id and working directory.
 */
const saveSession = async (run: Run) => {
  const session = await readSession(run);
  if (!session) return;
  const paths: string[] = [];
  for (const project of await readdir(TRANSCRIPTS).catch(() => [])) {
    for (const name of [`${session.id}.jsonl`, session.id]) {
      // Claude Code names the directories after the working directory, so
      // they start with "-", which tar would read as an option.
      if (existsSync(join(TRANSCRIPTS, project, name))) paths.push(`./${join(project, name)}`);
    }
  }
  if (paths.length > 0) {
    await withTempDir(async (dir) => {
      const tarball = join(dir, "session.tar.gz");
      const result = await exec("tar", ["-czf", tarball, "-C", TRANSCRIPTS, ...paths]);
      if (result.code !== 0) throw new Error(`tar failed: ${result.stderr.trim()}`);
      await putState(`${sessionKey(run)}.tar.gz`, await readFile(tarball));
    });
  }
  await putState(`${sessionKey(run)}.json`, Buffer.from(JSON.stringify(session)));
};

/** Restores the conversation's session from the state store, if this container doesn't have it. */
const restoreSession = async (run: Run) => {
  if (existsSync(sessionPath(run))) return;
  const session = await getState(`${sessionKey(run)}.json`);
  if (!session) return;
  const tarball = await getState(`${sessionKey(run)}.tar.gz`);
  if (tarball) {
    await mkdir(TRANSCRIPTS, { recursive: true });
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "session.tar.gz"), tarball);
      const result = await exec("tar", ["-xzf", join(dir, "session.tar.gz"), "-C", TRANSCRIPTS]);
      if (result.code !== 0) throw new Error(`tar failed: ${result.stderr.trim()}`);
    });
  }
  await mkdir(dirname(sessionPath(run)), { recursive: true });
  await writeFile(sessionPath(run), session);
};

/**
 * Runs Claude Code in `cwd` with the run's prompt, and returns its final
 * message. It resumes the conversation's session if the session ran in the
 * same worktree.
 */
const claude = async (run: Run, cwd: string) => {
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
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, FACTORY_TOKEN_FILE: tokenFile(run) },
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

/** Throws if `command` isn't on the PATH, since the repo's image installs each runtime's CLI. */
const assertCommand = async (command: string, name: string) => {
  const found = await exec("sh", ["-c", `command -v ${command}`]);
  if (found.code !== 0) {
    throw new Error(`The container's image has no \`${command}\`. Install ${name} in the image's Dockerfile.`);
  }
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
 * 2. Restores the conversation's session if this container doesn't have it.
 * 3. Writes the container's files and the policies' tokens.
 * 4. Runs the agent in the worktree, and has the router mint new tokens
 *    while it runs.
 * 5. Saves the worktree and the session to the state store.
 * 6. Posts the agent's final message, or the error, to the conversation,
 *    with notes on what couldn't be restored or saved.
 */
const execute = async (run: Run) => {
  const started = Date.now();
  log({ run: run.id, repo: run.repo, trigger: run.trigger, worktree: run.worktree?.branch ?? "scratch", state: "started" });
  const worktree = worktreeOf(run);
  const notes: string[] = [];
  let checkedOut = false;
  let text: string;
  try {
    if (run.agent.runtime !== "claude") throw new Error(`The runner can't run agents of the runtime ${run.agent.runtime}.`);
    await assertCommand("claude", "Claude Code");
    const repo = await fetchRepo(run);
    await checkout(run, repo, worktree, notes);
    checkedOut = true;
    await restoreSession(run).catch((error) =>
      notes.push(`Factory couldn't restore this conversation's session, so the agent started a new one: ${message(error)}`),
    );
    await writeFiles(run, worktree.path);
    await writeTokens(run.tokens);
    const refreshing = setInterval(
      () =>
        refreshTokens(run).catch((error) => {
          log({ run: run.id, state: "token refresh failed", error: message(error) });
          if (!notes.some((note) => note.startsWith("Factory couldn't refresh"))) {
            notes.push(`Factory couldn't refresh this run's GitHub tokens, so they may have expired during the run: ${message(error)}`);
          }
        }),
      TOKEN_REFRESH_MS,
    );
    try {
      text = await claude(run, worktree.path);
    } finally {
      clearInterval(refreshing);
    }
    log({ run: run.id, state: "finished", ms: Date.now() - started });
  } catch (error) {
    log({ run: run.id, state: "failed", error: message(error), ms: Date.now() - started });
    text = `The run failed: ${message(error)}`;
  }
  if (checkedOut) {
    try {
      await saveWorktree(worktree);
      await saveSession(run);
    } catch (error) {
      log({ run: run.id, state: "save failed", error: message(error) });
      notes.push(`Factory couldn't save this worktree and session, so they'll be lost when the container sleeps: ${message(error)}`);
    }
  }
  try {
    const reply = [text || "(The agent finished with no message.)", ...notes.map((note) => `> ${note}`)];
    await relay(run, reply.join("\n\n"));
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

/**
 * Git signs commits as the hub, and pushes with the token in the file that
 * `FACTORY_TOKEN_FILE` names. Each write locks the config file, so they
 * run in turn.
 */
const configureGit = async () => {
  await git(["config", "--global", "user.name", "Notation Factory"]);
  await git(["config", "--global", "user.email", "notation-factory@users.noreply.github.com"]);
  await git([
    "config",
    "--global",
    "credential.https://github.com.helper",
    '!f() { test -n "$FACTORY_TOKEN_FILE" || exit 0; echo username=x-access-token; echo "password=$(cat "$FACTORY_TOKEN_FILE")"; }; f',
  ]);
};

/**
 * Puts a `gh` in `/data/bin` that runs the installed `gh` with the token in
 * `FACTORY_TOKEN_FILE`. `GH_TOKEN` would keep the first token after the
 * router refreshes it.
 */
const installGh = async () => {
  const found = await exec("sh", ["-c", "command -v gh"]);
  const gh = found.stdout.trim();
  if (found.code !== 0 || !gh) return;
  await mkdir(BIN, { recursive: true });
  const script = `#!/bin/sh
if [ -n "$FACTORY_TOKEN_FILE" ]; then GH_TOKEN="$(cat "$FACTORY_TOKEN_FILE")"; export GH_TOKEN; fi
exec ${JSON.stringify(gh)} "$@"
`;
  await writeFile(join(BIN, "gh"), script, { mode: 0o755 });
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

// The runner is the container's PID 1, and Linux ignores a signal to PID 1
// that the process doesn't handle. The provider stops a sleeping container
// with SIGTERM.
process.on("SIGTERM", () => {
  log({ state: "stopping" });
  process.exit(0);
});

await configureGit();
await installGh();
server.listen(PORT, () => log({ state: "listening", port: PORT }));
