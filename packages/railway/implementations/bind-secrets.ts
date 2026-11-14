import type { VaultSecret } from "@notation/factory";
import type { ServiceInstance } from "../resources/service.ts";
import { assertRailwaySecret } from "./vault.ts";

/**
 * Gives `service` the variable `name`, whose value is a reference to the
 * secret's sealed shared variable.
 *
 * Railway resolves a reference only when it deploys the service, so a new
 * value reaches the service at its next deploy.
 */
export function bindSecret(
  service: ServiceInstance,
  name: string,
  secret: VaultSecret,
): void {
  assertRailwaySecret(secret);
  service.dependOn(secret.variable);
  service.contribute({ vars: { [name]: secret.reference } });
}
