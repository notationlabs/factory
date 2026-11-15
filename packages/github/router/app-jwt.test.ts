import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { appJwt } from "./app-jwt.ts";

const decode = (part: string) =>
  JSON.parse(Buffer.from(part, "base64url").toString());

for (const type of ["pkcs1", "pkcs8"] as const) {
  test(`appJwt signs with a ${type} key, and the claims name the App`, async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type, format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const jwt = await appJwt("12345", privateKey);
    const [header, claims, signature] = jwt.split(".");
    assert.deepEqual(decode(header!), { alg: "RS256", typ: "JWT" });
    const { iss, iat, exp } = decode(claims!);
    assert.equal(iss, "12345");
    assert.equal(exp - iat, 600);
    const verify = createVerify("RSA-SHA256");
    verify.update(`${header}.${claims}`);
    assert.equal(verify.verify(publicKey, Buffer.from(signature!, "base64url")), true);
  });
}
