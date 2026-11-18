const API = "https://api.cloudflare.com/client/v4";

type Envelope<T> = { success: boolean; result: T; errors?: { code: number; message: string }[] };

/** An error from the Cloudflare API, with the response's status. */
export class CloudflareApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Calls the Cloudflare API with `token`, and returns the envelope's result.
 * `path` is relative to `/client/v4`. A JSON `body` is sent as JSON, and a
 * `FormData` as a multipart form. Throws a `CloudflareApiError` for a status
 * other than 2xx.
 */
export const cloudflare = async <T = unknown>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> => {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${API}${path}`, { method, headers, body: payload });
  const text = await response.text();
  let envelope: Envelope<T> | undefined;
  try {
    envelope = text ? (JSON.parse(text) as Envelope<T>) : undefined;
  } catch {}
  if (!response.ok || envelope?.success === false) {
    const errors = envelope?.errors?.map((e) => `${e.code} ${e.message}`).join("; ") || text.slice(0, 500);
    throw new CloudflareApiError(response.status, `${method} ${path} failed with status ${response.status}: ${errors}`);
  }
  return envelope?.result as T;
};

/** Like `cloudflare`, but resolves to `undefined` for a 404. */
export const cloudflareOrNone = async <T = unknown>(token: string, method: string, path: string, body?: unknown) => {
  try {
    return await cloudflare<T>(token, method, path, body);
  } catch (error) {
    if (error instanceof CloudflareApiError && error.status === 404) return undefined;
    throw error;
  }
};
