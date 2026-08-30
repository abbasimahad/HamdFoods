import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

export function requireAccountingManager(actor: ApplicationPrincipal) {
  if (!actor.active || !actor.permissions.includes("accounting.manage"))
    throw new Error("Accounting management permission is required.");
}
