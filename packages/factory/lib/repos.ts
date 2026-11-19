import type { RepoPattern } from "../contracts/router.ts";

/** Whether `repo`, as `owner/name`, matches one of `allow`. A pattern without `repo` matches every repo of its owner. Case doesn't matter. */
export const allowsRepo = (allow: RepoPattern[], repo: string) => {
  const [owner, name] = repo.toLowerCase().split("/");
  return allow.some(
    (p) => p.owner.toLowerCase() === owner && (!p.repo || p.repo.toLowerCase() === name),
  );
};

/** Whether some repo matches a pattern in `a` and a pattern in `b`. */
export const reposOverlap = (a: RepoPattern[], b: RepoPattern[]) =>
  a.some((p) =>
    b.some(
      (q) =>
        p.owner.toLowerCase() === q.owner.toLowerCase() &&
        (!p.repo || !q.repo || p.repo.toLowerCase() === q.repo.toLowerCase()),
    ),
  );
