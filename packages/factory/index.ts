import { collectResourceGraph } from "@notation/resource";

export * from "./contracts/index.ts";
export { single } from "./lib/collect.ts";
export { isSecret, type Secret, secret } from "./lib/secret.ts";
export { Container, type ContainerOptions } from "./implementations/container.ts";
export {
  currentOutpost,
  Outpost,
  outpost,
} from "./implementations/outpost.ts";
export { Policy, type PolicyOptions } from "./implementations/policy.ts";
export { Trigger, type TriggerOptions } from "./implementations/trigger.ts";

/** The hub's infra: `export default factory(() => { … })`. Calling it collects the graph, concrete resources and all, for Notation to deploy. */
export const factory = (declare: () => void) => () =>
  collectResourceGraph(declare);
