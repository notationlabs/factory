const API_URL = "https://api.cloudflare.com/client/v4";

// The name that the dashboard gives the store it creates.
const DEFAULT_STORE_NAME = "default_secrets_store";

const PAGE_SIZE = 100;

type Store = { id: string; name: string };

type StoreSecret = {
  id: string;
  name: string;
  status: "pending" | "active" | "deleted";
};

const accountId = (): string => {
  const id = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!id) throw new Error("Set CLOUDFLARE_ACCOUNT_ID to the hub's account.");
  return id;
};

const apiToken = (): string => {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error(
      "Set CLOUDFLARE_API_TOKEN to an API token with the Secrets Store: Edit permission for the account.",
    );
  }
  return token;
};

const call = async <T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Cloudflare API ${method} ${path} failed with status ${response.status}: ${text}`,
    );
  }
  return (JSON.parse(text) as { result: T }).result;
};

const storesPath = (account: string) =>
  `/accounts/${encodeURIComponent(account)}/secrets_store/stores`;

const secretsPath = (account: string, store: string) =>
  `${storesPath(account)}/${encodeURIComponent(store)}/secrets`;

// Cloudflare allows one store per account.
const findStore = async (account: string): Promise<Store | undefined> =>
  ((await call<Store[] | null>("GET", storesPath(account))) ?? [])[0];

// `search` also matches part of a name or a comment, so each result is
// compared with the name.
const findSecret = async (
  account: string,
  store: string,
  name: string,
): Promise<StoreSecret | undefined> => {
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({
      search: name,
      page: String(page),
      per_page: String(PAGE_SIZE),
    });
    const secrets =
      (await call<StoreSecret[] | null>(
        "GET",
        `${secretsPath(account, store)}?${query}`,
      )) ?? [];
    const secret = secrets.find(
      (item) => item.name === name && item.status !== "deleted",
    );
    if (secret) return secret;
    if (secrets.length < PAGE_SIZE) return undefined;
  }
};

/** Creates the secret named `name`, or sets the value of the one that exists. Creates the account's store if it has none. */
export const writeSecret = async (name: string, value: string) => {
  const account = accountId();
  const store =
    (await findStore(account)) ??
    (await call<Store>("POST", storesPath(account), {
      name: DEFAULT_STORE_NAME,
    }));
  const existing = await findSecret(account, store.id, name);
  if (existing) {
    await call(
      "PATCH",
      `${secretsPath(account, store.id)}/${encodeURIComponent(existing.id)}`,
      { value },
    );
  } else {
    await call("POST", secretsPath(account, store.id), [
      { name, value, scopes: ["workers"] },
    ]);
  }
};

/** Succeeds when the secret or the store is already gone. */
export const deleteSecret = async (name: string) => {
  const account = accountId();
  const store = await findStore(account);
  if (!store) return;
  const existing = await findSecret(account, store.id, name);
  if (!existing) return;
  await call(
    "DELETE",
    `${secretsPath(account, store.id)}/${encodeURIComponent(existing.id)}`,
  );
};
