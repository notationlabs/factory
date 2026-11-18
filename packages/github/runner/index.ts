import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CodeHostRunner } from "@notation/factory";

const run = promisify(execFile);

/** How the runner clones from and pushes to GitHub. Containers import it with no packages, so it imports only Node's. */
const github: CodeHostRunner = {
  cloneUrl: (repo) => `https://github.com/${repo}.git`,
  gitAuth: (token) => [
    "-c",
    `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
  ],
  setup: async ({ bin }) => {
    await run("git", [
      "config",
      "--global",
      "credential.https://github.com.helper",
      '!f() { test -n "$FACTORY_TOKEN_FILE" || exit 0; echo username=x-access-token; echo "password=$(cat "$FACTORY_TOKEN_FILE")"; }; f',
    ]);
    // A `gh` in `bin` that runs the image's `gh` with the token in
    // `FACTORY_TOKEN_FILE`. `GH_TOKEN` would keep the first token after the
    // router refreshes it.
    const gh = await run("sh", ["-c", "command -v gh"]).then(
      ({ stdout }) => stdout.trim(),
      () => "",
    );
    if (!gh) return;
    await mkdir(bin, { recursive: true });
    const script = `#!/bin/sh
if [ -n "$FACTORY_TOKEN_FILE" ]; then GH_TOKEN="$(cat "$FACTORY_TOKEN_FILE")"; export GH_TOKEN; fi
exec ${JSON.stringify(gh)} "$@"
`;
    await writeFile(join(bin, "gh"), script, { mode: 0o755 });
  },
};

export default github;
