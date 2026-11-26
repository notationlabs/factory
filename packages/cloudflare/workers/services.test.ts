import assert from "node:assert/strict";
import { test } from "node:test";
import { isServiceName } from "@notation/factory/router";
import { forwardToService, fromSender } from "./services.ts";

const sender = { repo: "acme/api", container: "dev" };

test("a request from a container names its repo and container, and loses the x-factory headers it sent", async () => {
  const request = fromSender(
    new Request("http://drafts.factory/a/index.html", {
      method: "PUT",
      headers: { "x-factory-repo": "acme/other", "X-Factory-Anything": "1", "content-type": "text/html" },
      body: "<p>hi</p>",
    }),
    sender,
  );
  assert.equal(request.headers.get("x-factory-repo"), "acme/api");
  assert.equal(request.headers.get("x-factory-container"), "dev");
  assert.equal(request.headers.get("x-factory-anything"), null);
  assert.equal(request.headers.get("content-type"), "text/html");
  assert.equal(request.method, "PUT");
  assert.equal(request.url, "http://drafts.factory/a/index.html");
  assert.equal(await request.text(), "<p>hi</p>");
});

test("the router forwards a request to the binding of the service its host names", async () => {
  const seen: string[] = [];
  const bindings: Record<string, { fetch(request: Request): Promise<Response> }> = {
    SERVICE_DRAFTS: { fetch: async (request) => (seen.push(request.url), new Response("drafts")) },
  };
  const services = { drafts: { binding: "SERVICE_DRAFTS" } };
  const response = await forwardToService(new Request("http://drafts.factory/x"), services, (b) => bindings[b]);
  assert.equal(await response.text(), "drafts");
  assert.deepEqual(seen, ["http://drafts.factory/x"]);
});

test("the router answers 404 for a service the hub doesn't have", async () => {
  const services = { drafts: { binding: "SERVICE_DRAFTS" } };
  for (const url of ["http://notes.factory/", "http://drafts.example/", "http://constructor.factory/"]) {
    const response = await forwardToService(new Request(url), services, () => undefined);
    assert.equal(response.status, 404);
  }
  assert.equal((await forwardToService(new Request("http://drafts.factory/"), undefined, () => undefined)).status, 404);
});

test("a service's name is a lowercase DNS label that isn't state or runner", () => {
  for (const name of ["drafts", "a", "my-notes", "x1"]) assert.equal(isServiceName(name), true, name);
  for (const name of ["state", "runner", "Drafts", "-a", "a-", "a.b", "a_b", "", "a".repeat(64)]) {
    assert.equal(isServiceName(name), false, name);
  }
});
