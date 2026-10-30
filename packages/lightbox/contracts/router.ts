import type {
  BaseResource,
  DeepPartial,
  ResourceGroup,
} from "@notation/resource";
import type { Vault } from "./vault.ts";

/**
 * In the router's config: how to verify a connection's deliveries (`source`,
 * e.g. a GitHub App's id), and the vault items that hold its credentials.
 * Keyed by `<provider>/<name>`: outposts look a connection up by name, from
 * its provider's package, so a GitHub App and a Slack app may share a name.
 */
export type ConnectionEntry = {
  provider: string;
  source: string;
  credentials: Record<string, string>;
};

/** Repos a code host serves: all of `owner`'s, or just `owner/repo`. */
export type RepoPattern = { owner: string; repo?: string };

/** In the router's config: which repos get outposts, and the connection their tokens are minted through. */
export type CodeHostEntry = {
  provider: string;
  connection: string;
  allow: RepoPattern[];
};

/** In the router's config: how it checks who an operator is. The rest is the provider's. */
export type OperatorsEntry = { provider: string } & Record<string, unknown>;

/** The router's config. Connections are keyed by provider and name. An infra has one code host and one operator auth. */
export type RouterConfig = {
  connections: Record<string, ConnectionEntry>;
  codeHost: CodeHostEntry;
  operators: OperatorsEntry;
};

/** Where the router is reached: any concrete resource with a `url` output. */
export type RouterApi = BaseResource & { output: { url: string } };

/**
 * Where the router's config is kept: any concrete resource that takes
 * contributions to it. BaseResource's own `contribute` is omitted because it
 * takes any record, which would let a contribution of any shape through.
 */
export type RouterConfigStore = Omit<BaseResource, "contribute"> & {
  contribute(values: DeepPartial<RouterConfig>): void;
};

/**
 * Receives every connection's deliveries, matches outposts' triggers, relays
 * channel replies and mints code host tokens. A provider decides where each
 * part lives (a Worker and a KV entry, …). The config is `store`, not
 * `config`, which ResourceGroup already uses for the group's own options.
 * `vault` is on the router's own provider.
 */
export interface Router extends ResourceGroup {
  readonly api: RouterApi;
  readonly store: RouterConfigStore;
  readonly vault: Vault;
}
