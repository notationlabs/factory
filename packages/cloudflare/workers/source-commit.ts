import git from "isomorphic-git";
import { Volume } from "memfs";

type Fs = Parameters<typeof git.init>[0]["fs"] & {
  mkdirSync(path: string, options: { recursive: true }): void;
  writeFileSync(path: string, content: string): void;
  chmodSync(path: string, mode: number): void;
};

/**
 * Commits `files` to a new repo in memory, on branch `main`. The files at
 * `executables` get mode 100755, since isomorphic-git takes modes from the
 * file system.
 */
export const commitSource = async (files: Record<string, string>, executables: string[], message: string) => {
  const fs = Volume.fromJSON({}) as unknown as Fs;
  const dir = "/repo";
  const executable = new Set(executables);
  await git.init({ fs, dir, defaultBranch: "main" });
  for (const [path, content] of Object.entries(files)) {
    const full = `${dir}/${path}`;
    fs.mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
    fs.writeFileSync(full, content);
    if (executable.has(path)) fs.chmodSync(full, 0o755);
    await git.add({ fs, dir, filepath: path });
  }
  const commit = await git.commit({
    fs,
    dir,
    message,
    author: { name: "Notation Factory", email: "notation-factory@users.noreply.github.com" },
  });
  return { fs, dir, commit };
};
