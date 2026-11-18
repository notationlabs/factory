import { physicalName } from "@notation/resource";

/** GitHub App names are at most 34 characters. */
const GITHUB_APP_NAME_MAX_LENGTH = 34;

/** The hub a connection's App belongs to: its Notation app and stage. */
export type HubScope = { app: string; stage: string };

/** The name of a connection's GitHub App: `<app>--<stage>--<id>`, shortened with a hash past GitHub's limit. */
export const appName = (scope: HubScope | undefined, connectionId: string) =>
  physicalName(scope, connectionId, { maxLength: GITHUB_APP_NAME_MAX_LENGTH });
