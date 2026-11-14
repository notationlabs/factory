import {
  ResourceNotFoundError,
  ResourceOperationPendingError,
} from "@notation/resource";

const API_URL = "https://api.cloudflare.com/client/v4";

export type ValueKey = { AccountId: string; NamespaceId: string; Key: string };

class CloudflareApiError extends Error {
  readonly status: number;

  constructor(request: string, status: number, body: string) {
    super(`Cloudflare API ${request} failed with status ${status}: ${body}`);
    this.name = "CloudflareApiError";
    this.status = status;
  }
}

const isNotFound = (error: unknown) =>
  error instanceof CloudflareApiError && error.status === 404;

const apiToken = (): string => {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error(
      "Set CLOUDFLARE_API_TOKEN to an API token with the Workers KV Storage: Edit permission for the account.",
    );
  }
  return token;
};

const valuePath = ({ AccountId, NamespaceId, Key }: ValueKey) =>
  `/accounts/${AccountId}/storage/kv/namespaces/${NamespaceId}/values/${encodeURIComponent(Key)}`;

const send = async (
  method: "GET" | "PUT" | "DELETE",
  path: string,
  body?: FormData,
): Promise<string> => {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiToken()}` },
    body,
  });
  const text = await response.text();
  if (response.status === 429) {
    throw new ResourceOperationPendingError(
      `Cloudflare rate limited ${method} ${path}`,
      { retryAfterMs: 5_000, throttled: true },
    );
  }
  if (!response.ok) {
    throw new CloudflareApiError(`${method} ${path}`, response.status, text);
  }
  return text;
};

/**
 * Writes the value as JSON. A namespace created in the same deploy can be
 * missing from the KV calls for a few seconds, so a 404 asks the reconciler
 * to try again.
 */
export const putValue = async (key: ValueKey, value: unknown): Promise<void> => {
  const form = new FormData();
  // A Blob part is sent byte for byte. A string part would have its line
  // breaks turned into CRLF.
  form.set("value", new Blob([JSON.stringify(value)]));
  try {
    await send("PUT", valuePath(key), form);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    throw new ResourceOperationPendingError(
      `The KV namespace ${key.NamespaceId} isn't found yet. If it is still missing after about a minute, it may have been deleted outside Notation.`,
      { retryAfterMs: 2_000, cause: error },
    );
  }
};

/** Reads the value as JSON. Throws `ResourceNotFoundError` when the key or its namespace is gone. */
export const getValue = async (key: ValueKey): Promise<unknown> => {
  let text: string;
  try {
    text = await send("GET", valuePath(key));
  } catch (error) {
    if (isNotFound(error)) {
      throw new ResourceNotFoundError("KV key was not found", { cause: error });
    }
    throw error;
  }
  return JSON.parse(text);
};

/** Succeeds when the key or its namespace is already gone. */
export const deleteValue = async (key: ValueKey): Promise<void> => {
  try {
    await send("DELETE", valuePath(key));
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
};
