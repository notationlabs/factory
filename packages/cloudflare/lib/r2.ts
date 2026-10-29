/** The R2 API calls the router's bucket makes. Stubs: achq's plugin-cloudflare has the real ones. */

export const createBucket = async (_params: {
  name: string;
}): Promise<void> => {
  throw new Error("not implemented: create an R2 bucket");
};

export const getBucket = async (_key: {
  name: string;
}): Promise<{ name: string }> => {
  throw new Error("not implemented: read an R2 bucket");
};

export const deleteBucket = async (_key: { name: string }): Promise<void> => {
  throw new Error("not implemented: empty and delete an R2 bucket");
};
