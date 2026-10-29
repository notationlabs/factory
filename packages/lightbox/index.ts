import { collectResourceGraph } from "@notation/resource";

export * from "./contracts/index.ts";
export {
  Workspace,
  type WorkspaceEntry,
  type WorkspaceOptions,
} from "./implementations/workspace.ts";

/** The infra: `export default lightbox(() => { … })`. Calling it collects the graph, concrete resources and all, for Notation to deploy. */
export const lightbox = (declare: () => void) => () =>
  collectResourceGraph(declare);
