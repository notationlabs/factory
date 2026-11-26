import assert from "node:assert/strict";
import { test } from "node:test";
import { imageSource, instanceType } from "./outpost-source.ts";

const DOCKERFILE = "FROM oven/bun:1-debian\nRUN apt-get install -y git\n";
const accounts = { claude: { setup: "install claude\n" }, droid: { setup: "install droid\n" } };
const container = { runtimes: ["claude"], policies: [], files: {} };

/** The lines of Factory's layers, in order, as a pattern. */
const LAYERS =
  /USER root\nCOPY --from=oven\/bun:1-debian \/usr\/local\/bin\/bun \/usr\/local\/bin\/bun\n[\s\S]*COPY factory-runtimes \/tmp\/factory-runtimes\n[\s\S]*useradd[\s\S]*USER factory\nENV HOME=\/data\/home\nWORKDIR \/data\/home\n/;

test("a container with no image gets the default Dockerfile, with Factory's layers and its runtimes' setups", () => {
  const { source, image, context } = imageSource(container, {}, accounts, DOCKERFILE);
  assert.equal(image, "./Dockerfile");
  assert.equal(context, ".");
  assert.equal(source["factory-runtimes/claude.sh"], "install claude\n");
  assert.equal(source["factory-runtimes/droid.sh"], undefined);
  assert.ok(source.Dockerfile!.startsWith(DOCKERFILE));
  assert.match(source.Dockerfile!, LAYERS);
});

test("a container with no runtimes gets Factory's layers with no setups", () => {
  const { source } = imageSource({ ...container, runtimes: [] }, {}, accounts, DOCKERFILE);
  assert.match(source.Dockerfile!, /lists no runtimes/);
  assert.doesNotMatch(source.Dockerfile!, /factory-runtimes/);
  assert.match(source.Dockerfile!, /USER factory\n/);
});

test("a container with its own image gets its Dockerfile, with Factory's layers, and the setups in its .factory context", () => {
  const own = "FROM node:24-bookworm\nUSER node";
  const { source, image, context } = imageSource(
    { ...container, image: "./images/Dockerfile" },
    { "images/Dockerfile": own },
    accounts,
    DOCKERFILE,
  );
  assert.equal(image, "./Dockerfile");
  assert.equal(context, "./.factory");
  assert.equal(source[".factory/factory-runtimes/claude.sh"], "install claude\n");
  assert.ok(source.Dockerfile!.startsWith(`${own}\n\n`));
  assert.doesNotMatch(source.Dockerfile!, /oven\/bun:1-debian\nRUN apt-get install -y git/);
  assert.match(source.Dockerfile!, LAYERS);
});

test("a container with its own image and a runtime that has no setup leaves it to the image", () => {
  const { source } = imageSource({ ...container, image: "Dockerfile" }, { Dockerfile: "FROM debian" }, {}, DOCKERFILE);
  assert.equal(source[".factory/factory-runtimes/claude.sh"], undefined);
  assert.match(source.Dockerfile!, /lists no runtimes/);
});

test("a container with no image and a runtime that has no setup fails its deploy", () => {
  assert.throws(() => imageSource(container, {}, {}, DOCKERFILE), /no setup for the runtime claude/);
});

test("a container whose image doesn't exist fails its deploy", () => {
  assert.throws(() => imageSource({ ...container, image: "./Dockerfile" }, {}, accounts, DOCKERFILE), /\.factory\/Dockerfile doesn't exist/);
});

test("a container with no instance type gets standard-1", () => {
  assert.equal(instanceType(container), "standard-1");
});

test("a container gets the instance type it names", () => {
  assert.equal(instanceType({ ...container, instanceType: "standard-3" }), "standard-3");
});

test("a container with an instance type that Cloudflare doesn't have fails its deploy", () => {
  assert.throws(() => instanceType({ ...container, instanceType: "huge" }), /no instance type `huge`/);
});

test("a container with a custom size gets Wrangler's custom instance type", () => {
  assert.deepEqual(instanceType({ ...container, instanceType: { vcpu: 2, memoryMib: 10240, diskMb: 16000 } }), {
    vcpu: 2,
    memory_mib: 10240,
    disk_mb: 16000,
  });
});

test("a container with a custom size under Cloudflare's minimum fails its deploy", () => {
  assert.throws(
    () => instanceType({ ...container, instanceType: { vcpu: 1, memoryMib: 128, diskMb: 4000 } }),
    /memoryMib 256, and the container asks for 128/,
  );
});
