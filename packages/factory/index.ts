import { collectResourceGraph } from "@notation/resource";

export * from "./contracts/index.ts";
export { single } from "./lib/collect.ts";
export { generated } from "./lib/generated.ts";
export {
  Container,
  type ContainerOptions,
} from "./implementations/container.ts";
export { Outpost, OutpostGroup, outpost } from "./implementations/outpost.ts";
export { Policy, type PolicyOptions } from "./implementations/policy.ts";
export { Trigger, type TriggerOptions } from "./implementations/trigger.ts";
export { OutpostConfig } from "./resources/outpost-config.ts";

/** The hub's infra: `export default factory(() => { … })`. Calling it collects the graph, concrete resources and all, for Notation to deploy. */
export const factory = (declare: () => void) => () =>
  collectResourceGraph(declare);
