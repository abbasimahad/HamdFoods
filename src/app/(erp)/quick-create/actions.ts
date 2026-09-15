"use server";

import { revalidatePath } from "next/cache";

import { saveItem } from "@/modules/master-data/application/manage-items";
import { saveSupplier } from "@/modules/purchasing/application/manage-suppliers";
import { saveCustomer } from "@/modules/sales/application/manage-sales";
import type {
  QuickCreateKind,
  QuickCreateResult,
} from "@/modules/workflow-ux/application/quick-create-contracts";
import { requirePermission } from "@/server/auth/licensed-guards";
import { PrismaMasterDataRepository } from "@/server/master-data/prisma-master-data-repository";
import { PrismaPurchasingRepository } from "@/server/purchasing/prisma-purchasing-repository";
import { dispatchQuickCreate } from "@/server/quick-create/quick-create-dispatch";
import { PrismaSalesRepository } from "@/server/sales/prisma-sales-repository";

const kinds = new Set<QuickCreateKind>([
  "customer",
  "supplier",
  "product",
  "material",
  "packaging",
]);

export async function quickCreateAction(
  _previous: QuickCreateResult,
  formData: FormData,
): Promise<QuickCreateResult> {
  const rawKind = String(formData.get("kind") ?? "");
  if (!kinds.has(rawKind as QuickCreateKind)) {
    return { ok: false, message: "Select a valid record type." };
  }
  const kind = rawKind as QuickCreateKind;
  const permission =
    kind === "customer"
      ? "sales.manage"
      : kind === "supplier"
        ? "purchasing.manage"
        : "inventory.manage";
  const actor = await requirePermission(permission);
  const data = Object.fromEntries(formData);
  const result = await dispatchQuickCreate(actor, kind, data, {
    saveCustomer: (principal, input) => saveCustomer(principal, input, new PrismaSalesRepository()),
    saveSupplier: (principal, input) =>
      saveSupplier(principal, input, new PrismaPurchasingRepository()),
    saveItem: (principal, input) => saveItem(principal, input, new PrismaMasterDataRepository()),
  });
  if (result.ok) refresh(kind);
  return result;
}

function refresh(kind: QuickCreateKind) {
  if (kind === "customer") revalidatePath("/sales/customers");
  else if (kind === "supplier") revalidatePath("/purchasing/suppliers");
  else if (kind === "product") revalidatePath("/inventory/finished-goods");
  else if (kind === "material") revalidatePath("/inventory/raw-materials");
  else revalidatePath("/inventory/packaging-materials");
}
