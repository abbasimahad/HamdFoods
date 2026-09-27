import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

export class AccountingPermissionError extends Error {}

export function requireAccountingManager(actor: ApplicationPrincipal) {
  if (!actor.active || !actor.permissions.includes("accounting.manage"))
    throw new AccountingPermissionError("Accounting management permission is required.");
}
