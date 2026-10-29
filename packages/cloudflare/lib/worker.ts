/** The Workers API calls the router's Worker makes. Stubs: achq's plugin-cloudflare has the real ones. */

export const uploadScript = async (_params: {
  ScriptName: string;
  ConfigNamespaceId: string;
}): Promise<void> => {
  throw new Error("not implemented: upload the router's script, bound to its config namespace");
};

export const getScript = async (_key: {
  ScriptName: string;
}): Promise<{ url: string }> => {
  throw new Error("not implemented: read the script and its workers.dev URL");
};

export const deleteScript = async (_key: {
  ScriptName: string;
}): Promise<void> => {
  throw new Error("not implemented: delete the script");
};
