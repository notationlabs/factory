import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { readDir, sourceChanges } from "./repos.ts";

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

test("reading a directory notes which of its files the repo marks executable", async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const tree = [
    { path: ".factory/infra.ts", mode: "100644", type: "blob", sha: "a" },
    { path: ".factory/bin/start", mode: "100755", type: "blob", sha: "b" },
    { path: "README.md", mode: "100755", type: "blob", sha: "c" },
  ];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const { pathname } = new URL(String(input instanceof Request ? input.url : input));
    if (pathname.endsWith("/installation")) return Response.json({ id: 1 });
    if (pathname.endsWith("/access_tokens")) return Response.json({ token: "t" });
    if (pathname.includes("/commits/")) return Response.json({ sha: "abc", commit: { tree: { sha: "root" } } });
    if (pathname.includes("/git/trees/")) return Response.json({ truncated: false, tree });
    const blob = pathname.match(/\/git\/blobs\/(\w+)$/);
    if (blob) return new Response(`content ${blob[1]}`);
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;
  try {
    const read = await readDir({ appId: "123", privateKey }, "acme/api", ".factory", "abc");
    assert.deepEqual(read, {
      ref: "abc",
      files: { "infra.ts": "content a", "bin/start": "content b" },
      executables: ["bin/start"],
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});
