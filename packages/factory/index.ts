import { collectResourceGraph } from "@notation/resource";

export * from "./contracts/index.ts";
export {
  Workspace,
  type WorkspaceEntry,
  type WorkspaceOptions,
} from "./implementations/workspace.ts";

/** The infra: `export default factory(() => { … })`. Calling it collects the graph, concrete resources and all, for Notation to deploy. */
export const factory = (declare: () => void) => () =>
  collectResourceGraph(declare);
