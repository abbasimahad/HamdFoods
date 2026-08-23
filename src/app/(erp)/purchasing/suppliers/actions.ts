"use server";

import { revalidatePath } from "next/cache";

import type { PurchasingActionState } from "@/components/purchasing/action-state";
import { saveSupplier, setSupplierActive } from "@/modules/purchasing/application/manage-suppliers";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchasingRepository } from "@/server/purchasing/prisma-purchasing-repository";

const repository = new PrismaPurchasingRepository();

export async function saveSupplierAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const result = await saveSupplier(actor, Object.fromEntries(formData), repository);
  if (result.ok) {
    revalidatePath("/purchasing/suppliers");
    if (result.id) revalidatePath(`/purchasing/suppliers/${result.id}`);
  }
  return { ok: result.ok, message: result.ok ? "Supplier saved." : result.message };
}

export async function setSupplierStatusAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const result = await setSupplierActive(
    actor,
    String(formData.get("id") ?? ""),
    formData.get("active") === "true",
    repository,
  );
  if (result.ok) {
    revalidatePath("/purchasing/suppliers");
    revalidatePath(`/purchasing/suppliers/${result.id}`);
  }
  return { ok: result.ok, message: result.ok ? "Supplier status updated." : result.message };
}
