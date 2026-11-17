import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceChanges } from "./repos.ts";

const repository = { full_name: "acme/api", default_branch: "main" };

test("a push to the default branch changes the repo at the pushed commit", () => {
  assert.deepEqual(sourceChanges("push", { ref: "refs/heads/main", after: "abc", repository }), [
    { repo: "acme/api", ref: "abc" },
  ]);
});

test("a push to another branch, or a deleted default branch, changes nothing", () => {
  assert.equal(sourceChanges("push", { ref: "refs/heads/feature", after: "abc", repository }), undefined);
  assert.equal(sourceChanges("push", { ref: "refs/heads/main", deleted: true, repository }), undefined);
});

test("an install adds its repos, and an uninstall removes them", () => {
  const repositories = [{ full_name: "acme/api" }, { full_name: "acme/web" }];
  assert.deepEqual(sourceChanges("installation", { action: "created", repositories }), [
    { repo: "acme/api" },
    { repo: "acme/web" },
  ]);
  assert.deepEqual(sourceChanges("installation", { action: "deleted", repositories }), [
    { repo: "acme/api", removed: true },
    { repo: "acme/web", removed: true },
  ]);
  assert.equal(sourceChanges("installation", { action: "new_permissions_accepted", repositories }), undefined);
});

test("repos added to and removed from an install change", () => {
  assert.deepEqual(
    sourceChanges("installation_repositories", {
      action: "added",
      repositories_added: [{ full_name: "acme/api" }],
      repositories_removed: [{ full_name: "acme/old" }],
    }),
    [{ repo: "acme/api" }, { repo: "acme/old", removed: true }],
  );
});

test("other events change nothing", () => {
  assert.equal(sourceChanges("issue_comment", { action: "created", repository }), undefined);
});
