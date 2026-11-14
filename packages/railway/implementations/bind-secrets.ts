import { onEvaluationEnd } from "@notation/resource";
import type { SecretConsumer } from "@notation/factory";
import type { ServiceInstance } from "../resources/service.ts";
import type { Vault } from "./vault.ts";

/**
 * Gives `service` a variable for each secret that `consumer` binds. The
 * variable is named after the secret's binding, and its value is a
 * reference to the sealed shared variable, which Railway resolves when it
 * deploys the service. Secrets are declared until evaluation ends, so the
 * variables are added then.
 *
 * Railway resolves a reference only when it deploys the service, so a new
 * value reaches the service at its next deploy.
 */
export function bindSecrets(
  service: ServiceInstance,
  vault: Vault,
  consumer: SecretConsumer,
): void {
  onEvaluationEnd(() => {
    const secrets = vault.bindings(consumer);
    if (secrets.length === 0) return;
    for (const secret of secrets) service.dependOn(secret.variable);
    service.contribute({
      vars: Object.fromEntries(secrets.map((s) => [s.binding, s.reference])),
    });
  });
}
