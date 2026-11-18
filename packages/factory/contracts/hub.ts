import type { ResourceGroup } from "@notation/resource";
import type { Connection } from "./connection.ts";
import type { Runtime } from "./outpost.ts";
import type { RepoPattern, Router } from "./router.ts";
import type { Vault, VaultSecret } from "./vault.ts";

/** Where the repos live, which of them get outposts (`allow`), and what mints containers' code credentials. An infra has one. */
export interface CodeHost extends ResourceGroup {
  readonly connection: Connection;
  readonly allow: RepoPattern[];
  /** The source of its runner module, a `CodeHostRunner`, which the runner imports to clone and push. */
  readonly runner?: string;
}

/** Who may run the CLI against the running hub. Declared, not managed: it contributes to the router's config. */
export interface OperatorAuth extends ResourceGroup {
  readonly provider: string;
}

/**
 * Credentials an agent runtime runs on. The deployer binds each of `secrets`
 * and injects it into containers that list `runtime`.
 */
export interface Account extends ResourceGroup {
  readonly runtime: Runtime;
  /** Keyed by the env var name that containers read the secret as, such as `CLAUDE_CODE_OAUTH_TOKEN`. */
  readonly secrets: Record<string, VaultSecret>;
}

/** Checks and builds outposts' containers, and gives them `accounts`' credentials. */
export interface Deployer extends ResourceGroup {
  readonly router: Router;
  readonly vault: Vault;
  readonly accounts: Account[];
}
