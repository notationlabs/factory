import type { ResourceGroup } from "@notation/resource";
import type { Secret } from "../lib/secret.ts";
import type { Connection } from "./connection.ts";
import type { Runtime } from "./outpost.ts";
import type { RepoPattern, Router } from "./router.ts";

/** Where the repos live, which of them get outposts (`allow`), and what mints containers' code credentials. An infra has one. */
export interface CodeHost extends ResourceGroup {
  readonly connection: Connection;
  readonly allow: RepoPattern[];
}

/** Who may run the CLI against the running hub. Declared, not managed: it contributes to the router's config. */
export interface OperatorAuth extends ResourceGroup {
  readonly provider: string;
}

/** Credentials an agent runtime runs on. The deployer writes `secrets` to the vault and injects them, by env var, into containers that list `runtime`. */
export interface Account extends ResourceGroup {
  readonly runtime: Runtime["id"];
  readonly secrets: Record<string, Secret>;
}

/** Checks and builds outposts' containers, and gives them `accounts`' credentials. */
export interface Deployer extends ResourceGroup {
  readonly router: Router;
  readonly accounts: Account[];
}
