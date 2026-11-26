# Plugin Overview

Notation Factory separates declarative resource contracts from concrete integrations. A plugin is an npm package that implements interfaces from `@notation/factory` using Notation `ResourceGroup` classes and optional worker or container runtime modules.

Every constructor takes an `id` followed by one options object containing configuration fields and group dependencies together. Constructors extract dependencies first, validate configuration with a schema such as Valibot, pass the remaining config to `super`, and declare child resources or contributions.

```ts [src/account.ts]
import { ResourceGroup } from "@notation/resource";
import { type Account as AccountContract, type VaultSecret } from "@notation/factory";
import { runtime } from "./runtime.ts";

export type AccountOptions = { auth: VaultSecret };

export class Account extends ResourceGroup implements AccountContract {
  readonly runtime = runtime;
  readonly secrets: Record<string, VaultSecret>;

  constructor(id: string, { auth }: AccountOptions) {
    super("acme-agent/Account", id);
    this.secrets = { ACME_API_KEY: auth };
  }
}
```

## Hub vs outpost packages

Plugins often span both `factory.infra.ts` and `.factory/infra.ts`. Hub code runs with full Node and cloud access during deploy, whereas outpost configs run inside an isolated Worker Loader during repository evaluation.

| Export condition | Behavior |
| :--- | :--- |
| `default` | Runs during hub `notation deploy` with `ResourceGroup` |
| `factory-outpost` | Runs during sandbox `.factory/infra.ts` evaluation with `OutpostGroup` |

Packages used in `.factory/infra.ts` must provide a lightweight `factory-outpost` entrypoint in `package.json` so bundler builds never pull Node APIs or hub-only secrets into outpost isolates:

```json [package.json]
{
  "exports": {
    ".": {
      "factory-outpost": "./implementations/outpost.ts",
      "default": "./implementations/index.ts"
    }
  },
  "peerDependencies": {
    "@notation/factory": "^0.5.2"
  }
}
```

Take `@notation/factory` as a peer dependency rather than a direct dependency so every plugin registers into the caller's resource collection.

## Outpost groups and SDK allowlist

Outpost plugins extend `OutpostGroup` instead of `ResourceGroup`. It locates the active outpost collection automatically and exposes `this.outpost.store.contribute(...)` without requiring callers to pass an outpost reference.

The deployer's sandboxed `sdk.gen.ts` bundle pre-bundles only the official workspace packages listed in `SDK_PACKAGES` inside `packages/factory/deployer/sdk.ts`. Adding a built-in outpost import requires registering that package in `SDK_PACKAGES`.

Third-party packages work without SDK changes for hub resources and server modules:

- **Hub contracts** – `Vault`, `Router`, `Deployer`, and `Account`
- **Server modules** – Custom `CodeHost` and `Channel` implementations

## Contract map

| Guide | Contracts |
| :--- | :--- |
| [Hub Providers](./providers.md) | `Vault`, `Router`, `Deployer` |
| [Channels & Code Hosts](./channels-and-hosts.md) | `Connection`, `Channel`, `CodeHost`, `PolicyContract`, `OperatorAuth` |
| [Agent Runtimes](./runtimes.md) | `Runtime`, `Account`, `Agent`, `RuntimeRunner` |
| [Services](./services.md) | `Service` |
