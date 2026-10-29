import { defineResource } from "@notation/resource";
import { createBucket, deleteBucket, getBucket } from "../lib/r2.ts";

type R2BucketApi = {
  Key: { name: string };
  CreateParams: { name: string };
  UpdateParams: undefined;
  ReadResult: { name: string };
};

/** The project's bucket: outposts' `/data` archives across image rebuilds. */
export const R2Bucket = defineResource<R2BucketApi>({
  type: "cloudflare/r2/Bucket",
})
  .defineSchema({
    name: {
      propertyType: "param",
      presence: "required",
      primaryKey: true,
      immutable: true,
    },
  } as const)
  .defineOperations({
    create: async (params) => createBucket(params),
    read: async (key) => getBucket(key),
    delete: async (key) => deleteBucket(key),
  });

export type R2BucketInstance = InstanceType<typeof R2Bucket>;
