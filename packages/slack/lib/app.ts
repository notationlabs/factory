/** The Slack calls an app makes. Stubs. */

export const createApp = async (_params: {
  name: string;
  workspace: string;
  requestUrl: string;
}): Promise<{ appId: string }> => {
  throw new Error(
    "not implemented: create the app from a manifest, in the browser, and install it to the workspace",
  );
};

export const readApp = async (_key: {
  appId: string;
}): Promise<{ appId: string }> => {
  throw new Error("not implemented: read the app's manifest");
};

export const setRequestUrl = async (
  _key: { appId: string },
  _requestUrl: string,
): Promise<void> => {
  throw new Error("not implemented: set the app's Events API request URL");
};
