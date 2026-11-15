const encoder = new TextEncoder();

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const derLength = (n: number) =>
  n < 0x80
    ? [n]
    : n < 0x100
      ? [0x81, n]
      : n < 0x10000
        ? [0x82, n >> 8, n & 0xff]
        : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff];

const der = (tag: number, body: Uint8Array) =>
  new Uint8Array([tag, ...derLength(body.length), ...body]);

// AlgorithmIdentifier for rsaEncryption (1.2.840.113549.1.1.1) with NULL
// parameters, and the PKCS#8 version 0.
const RSA_ALGORITHM = [
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
  0x05, 0x00,
];
const VERSION_0 = [0x02, 0x01, 0x00];

/**
 * The PKCS#8 DER of a PEM private key. GitHub issues App keys as PKCS#1
 * (`BEGIN RSA PRIVATE KEY`), which Web Crypto can't import, so a PKCS#1 key
 * is wrapped in a PKCS#8 structure.
 */
const pkcs8 = (pem: string): Uint8Array<ArrayBuffer> => {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  if (!pem.includes("BEGIN RSA PRIVATE KEY")) return bytes;
  const inner = new Uint8Array([
    ...VERSION_0,
    ...RSA_ALGORITHM,
    ...der(0x04, bytes),
  ]);
  return der(0x30, inner);
};

/** A JWT that authenticates as the App with id `appId`. It is valid for 9 minutes, from a minute ago to allow for clock drift. */
export const appJwt = async (appId: string, privateKeyPem: string) => {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64url(
    encoder.encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId })),
  );
  const input = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(input),
  );
  return `${input}.${base64url(new Uint8Array(signature))}`;
};
