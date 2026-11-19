import assert from "node:assert/strict";
import { test } from "node:test";
import git from "isomorphic-git";
import { commitSource } from "./source-commit.ts";

test("the commit keeps the files at executables executable, and the rest not", async () => {
  const files = { "Dockerfile": "FROM scratch\n", ".factory/bin/start": "#!/bin/sh\n", ".factory/infra.ts": "export {}\n" };
  const { fs, dir, commit } = await commitSource(files, [".factory/bin/start"], "test");
  const modes: Record<string, string> = {};
  await git.walk({
    fs,
    dir,
    trees: [git.TREE({ ref: commit })],
    map: async (path, [entry]) => {
      if ((await entry!.type()) === "blob") modes[path] = (await entry!.mode()).toString(8);
    },
  });
  assert.deepEqual(modes, { Dockerfile: "100644", ".factory/bin/start": "100755", ".factory/infra.ts": "100644" });
});
