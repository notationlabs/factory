/** The Workers API calls the hub's Workers make. Stubs: achq's plugin-cloudflare has the real ones. */

export const uploadScript = async (_params: {
  ScriptName: string;
  KvNamespaceId: string;
  SecretsStoreId: string;
  BucketName?: string;
  ContainerInstanceType?: string;
  IdleTimeout?: string;
  Vars?: Record<string, unknown>;
}): Promise<void> => {
  throw new Error(
    "not implemented: upload a hub script, bound to its namespace, store and bucket",
  );
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
