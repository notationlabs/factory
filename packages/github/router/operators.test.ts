import assert from "node:assert/strict";
import { test } from "node:test";
import { signIn, signInUrl } from "./operators.ts";

const app = { clientId: "Iv1.abc", clientSecret: "shh" };

const withFetch = async (answer: (url: string, init?: RequestInit) => Response, run: (calls: string[]) => Promise<void>) => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return answer(url, init);
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
};

test("signInUrl names the App's client, the CLI's callback and the state", () => {
  assert.equal(
    signInUrl("Iv1.abc", "s1"),
    "https://github.com/login/oauth/authorize?client_id=Iv1.abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A47219%2Fcallback&state=s1",
  );
});

test("signIn exchanges the code, reads the user's login, and revokes the token", async () => {
  await withFetch(
    (url, init) => {
      if (url.endsWith("/login/oauth/access_token")) {
        assert.deepEqual(JSON.parse(String(init?.body)), { client_id: "Iv1.abc", client_secret: "shh", code: "c1", redirect_uri: "http://127.0.0.1:47219/callback" });
        return Response.json({ access_token: "ghu_1" });
      }
      if (url.endsWith("/user")) return Response.json({ login: "alice" });
      return new Response(null, { status: 204 });
    },
    async (calls) => {
      assert.equal(await signIn(app, "c1"), "alice");
      assert.deepEqual(calls, [
        "POST https://github.com/login/oauth/access_token",
        "GET https://api.github.com/user",
        "DELETE https://api.github.com/applications/Iv1.abc/token",
      ]);
    },
  );
});

test("signIn fails with GitHub's reason when it refuses the code", async () => {
  await withFetch(
    () => Response.json({ error: "bad_verification_code", error_description: "The code passed is incorrect or expired." }),
    async () => {
      await assert.rejects(signIn(app, "c1"), /The code passed is incorrect or expired/);
    },
  );
});
