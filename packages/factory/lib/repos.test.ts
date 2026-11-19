import assert from "node:assert/strict";
import { test } from "node:test";
import { allowsRepo, reposOverlap } from "./repos.ts";

test("a pattern without a repo allows every repo of its owner, whatever the case", () => {
  assert.equal(allowsRepo([{ owner: "acme" }], "Acme/Web"), true);
  assert.equal(allowsRepo([{ owner: "acme", repo: "web" }], "acme/WEB"), true);
  assert.equal(allowsRepo([{ owner: "acme", repo: "web" }], "acme/api"), false);
  assert.equal(allowsRepo([{ owner: "acme" }], "other/web"), false);
});

test("patterns overlap when one repo matches both", () => {
  assert.equal(reposOverlap([{ owner: "acme" }], [{ owner: "ACME", repo: "web" }]), true);
  assert.equal(reposOverlap([{ owner: "acme", repo: "web" }], [{ owner: "acme", repo: "Web" }]), true);
  assert.equal(reposOverlap([{ owner: "acme", repo: "web" }], [{ owner: "acme", repo: "api" }]), false);
  assert.equal(reposOverlap([{ owner: "acme" }], [{ owner: "other" }]), false);
});
