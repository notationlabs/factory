import assert from "node:assert/strict";
import { test } from "node:test";
import { imageSource } from "./outpost-source.ts";

const DOCKERFILE = "FROM oven/bun:1-debian\n# factory:runtimes\nUSER factory\n";
const accounts = { claude: { setup: "install claude\n" }, droid: { setup: "install droid\n" } };
const container = { runtimes: ["claude"], policies: [], files: {} };

test("a container with no image gets the default Dockerfile with its runtimes' setups", () => {
  const { source, image, context } = imageSource(container, {}, accounts, DOCKERFILE);
  assert.equal(image, "./Dockerfile");
  assert.equal(context, ".");
  assert.equal(source["factory-runtimes/claude.sh"], "install claude\n");
  assert.match(source.Dockerfile!, /COPY factory-runtimes \/tmp\/factory-runtimes/);
  assert.doesNotMatch(source.Dockerfile!, /# factory:runtimes/);
  assert.match(source.Dockerfile!, /USER factory/);
});

test("a container with no runtimes gets the default Dockerfile with no setups", () => {
  const { source } = imageSource({ ...container, runtimes: [] }, {}, accounts, DOCKERFILE);
  assert.match(source.Dockerfile!, /lists no runtimes/);
  assert.equal(source["factory-runtimes/claude.sh"], undefined);
});

test("a container with its own image gets the setups in its .factory context", () => {
  const { source, image, context } = imageSource(
    { ...container, image: "./Dockerfile" },
    { Dockerfile: "FROM oven/bun:1-debian" },
    accounts,
    DOCKERFILE,
  );
  assert.equal(image, "./.factory/Dockerfile");
  assert.equal(context, "./.factory");
  assert.equal(source[".factory/factory-runtimes/claude.sh"], "install claude\n");
  assert.equal(source.Dockerfile, undefined);
});

test("a container with no image and a runtime that has no setup fails its deploy", () => {
  assert.throws(() => imageSource(container, {}, {}, DOCKERFILE), /no setup for the runtime claude/);
});

test("a default Dockerfile with no marker fails its deploy", () => {
  assert.throws(() => imageSource(container, {}, accounts, "FROM oven/bun:1-debian\n"), /no `# factory:runtimes` line/);
});
