import type {
  DeepInput,
  Input,
  OutputRef,
  ResourceGroup,
} from "@notation/resource";
import type { CodeHost } from "./hub.ts";
import type { Vault, VaultSecret } from "./vault.ts";

/**
 * In the router's config: where a connection's deliveries come from
 * (`source`, e.g. a GitHub App's id), the binding names of the vault secrets
 * that the router reads for it, and the name the router reaches its channel
 * by.
 * Keyed by `<provider>/<name>`: outposts look a connection up by name, from
 * its provider's package, so a GitHub App and a Slack app may share a name.
 */
export type ConnectionEntry = {
  provider: string;
  source: string;
  credentials: Record<string, string>;
  channel?: string;
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

/** In the router's config: the name the router reaches a service by. */
export type ServiceEntry = { binding: string };

/** The router's config. Connections are keyed by provider and name, and services by name. An infra has one code host and one operator auth. */
export type RouterConfig = {
  connections: Record<string, ConnectionEntry>;
  codeHost: CodeHostEntry;
  operators: OperatorsEntry;
  services: Record<string, ServiceEntry>;
};

type ConfigPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: ConfigPartial<T[K]> }
    : T;

/**
 * A contribution to the router's config: any object key can be left out, and
 * an array is given whole. Any value can be a ref.
 */
export type RouterConfigContribution = {
  [K in keyof RouterConfig]?: DeepInput<ConfigPartial<RouterConfig[K]>>;
};

/**
 * Where the router's config is kept: anything that takes contributions to
 * it, such as a resource or a `kvJson()` document.
 */
export type RouterConfigStore = {
  contribute(values: RouterConfigContribution): void;
};

/** A connection's channel, which the router runs and calls for each delivery to the connection. */
export type RouterChannelOptions = {
  /** The connection's key in the router's config, such as `github/gh`. */
  connection: string;
  /** The absolute path of the module that exports the provider's `channel`, a `ChannelModule`. */
  module: string;
  /** The vault secrets that the channel reads with `ctx.secret(name)`. */
  secrets?: Record<string, VaultSecret>;
  /** The values that the channel reads with `ctx.value(name)`. */
  values?: Record<string, Input<string>>;
};

/**
 * Receives every connection's deliveries, matches outposts' triggers, relays
 * channel replies and mints code host tokens. A provider decides where each
 * part lives (a Worker and a KV entry, …). The config is `store`, not
 * `config`, which ResourceGroup already uses for the group's own options.
 * `vault` is on the router's own provider. `rootKey` is the secret that the
 * router and the deployer derive every other key from.
 */
export interface Router extends ResourceGroup {
  /** The router's URL, which deploy fills in. Join a path to it with `text`. */
  readonly url: OutputRef<string>;
  readonly store: RouterConfigStore;
  readonly vault: Vault;
  readonly rootKey: VaultSecret;
  /** The infra's code host, which sets itself here when it's declared. */
  codeHost?: CodeHost;
  /**
   * Binds a secret from the router's vault to the router, and returns the
   * name the router reads it as. The name is made from the secret's id,
   * unless `name` is given. A connection binds its credentials this way, and
   * records the names in its entry.
   */
  bind(secret: VaultSecret, name?: string): string;
  /**
   * Runs a connection's channel, and records in the connection's entry the
   * name the router reaches it by.
   */
  channel(options: RouterChannelOptions): void;
}
