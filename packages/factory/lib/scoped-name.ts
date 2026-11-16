import { getActiveResourceCollection, physicalName } from "@notation/resource";

/**
 * Makes the name of a resource that Notation doesn't name itself, such as a
 * KV namespace's title: `<app>--<stage>--<name>`, cut to `maxLength` with a
 * hash at the end. Outside a deploy, plan or viz there is no app and stage,
 * and the name is `name`.
 */
export const scopedName = (name: string, maxLength: number): string =>
  physicalName(getActiveResourceCollection()?.scope, name, { maxLength });
