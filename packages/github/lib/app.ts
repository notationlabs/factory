import type { GithubEvent, Permissions } from "./permissions.ts";

/** The GitHub calls an App makes. Stubs: lightbox's plugin-github has the real ones (lib/manifest.ts, @lightbox/utils/gh). */
export const createApp = async (_params: {
  name: string;
  org?: string;
  hookUrl: string;
  events?: GithubEvent[];
  permissions?: Permissions;
}): Promise<{ slug: string }> => {
  throw new Error("not implemented: GitHub's manifest flow, in the browser");
};

export const readApp = async (_key: {
  slug: string;
}): Promise<{ slug: string; id: string; privateKey: string }> => {
  throw new Error("not implemented: read the App with its key");
};

export const setWebhook = async (
  _key: { slug: string },
  _hookUrl: string,
): Promise<void> => {
  throw new Error("not implemented: set the App's webhook");
};

/** GitHub has no API for an App's events and permissions: they're changed on its settings page, and installs approve new permissions. */
export const requestAppChange = async (
  _key: { slug: string },
  _change: { events?: GithubEvent[]; permissions?: Permissions },
): Promise<void> => {
  throw new Error(
    "not implemented: change the App's events and permissions on its settings page",
  );
};
