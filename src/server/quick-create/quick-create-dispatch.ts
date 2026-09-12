import "server-only";

import { hasPermission, type ApplicationPrincipal } from "@/modules/access/domain/principal";
import type {
  QuickCreateDependencies,
  QuickCreateKind,
  QuickCreateMutationResult,
  QuickCreateResult,
} from "@/modules/workflow-ux/application/quick-create-contracts";

export type { QuickCreateDependencies } from "@/modules/workflow-ux/application/quick-create-contracts";

const itemTypes = {
  product: "FINISHED_GOOD",
  material: "RAW_MATERIAL",
  packaging: "PACKAGING_MATERIAL",
} as const;

export async function dispatchQuickCreate(
  actor: ApplicationPrincipal,
  kind: QuickCreateKind,
  data: Record<string, unknown>,
  dependencies: QuickCreateDependencies,
): Promise<QuickCreateResult> {
  const denied = permissionFailure(actor, kind);
  if (denied) return denied;

  let result: QuickCreateMutationResult;
  if (kind === "customer") {
    result = await dependencies.saveCustomer(actor, data);
  } else if (kind === "supplier") {
    result = await dependencies.saveSupplier(actor, data);
  } else {
    result = await dependencies.saveItem(actor, { ...data, itemType: itemTypes[kind] });
  }

  if (!result.ok) return result;
  if (!result.id) return { ok: false, message: "The new record could not be selected." };

  return {
    ok: true,
    option: {
      value: result.id,
      label: `${normalizeCode(data.code)} · ${String(data.name ?? "").trim()}`,
    },
  };
}

function permissionFailure(
  actor: ApplicationPrincipal,
  kind: QuickCreateKind,
): Extract<QuickCreateResult, { ok: false }> | null {
  if (kind === "customer") {
    return hasPermission(actor, "sales.manage")
      ? null
      : { ok: false, message: "Sales management permission is required." };
  }
  if (kind === "supplier") {
    return hasPermission(actor, "purchasing.manage")
      ? null
      : { ok: false, message: "Purchasing management permission is required." };
  }
  return hasPermission(actor, "inventory.manage")
    ? null
    : { ok: false, message: "You cannot manage inventory master data." };
}

function normalizeCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
