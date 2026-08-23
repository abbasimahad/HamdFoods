"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PurchasingActionState } from "@/components/purchasing/action-state";
import {
  cancelPurchaseReturn,
  postPurchaseReturn,
  quarantinePurchasedMaterial,
  savePurchaseReturn,
} from "@/modules/purchasing/application/manage-purchase-returns";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchaseReturnRepository } from "@/server/purchasing/prisma-purchase-return-repository";

const repository = new PrismaPurchaseReturnRepository();
export async function savePurchaseReturnAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const result = await savePurchaseReturn(actor, Object.fromEntries(formData), repository);
  if (result.ok && result.id) {
    refresh(result.id);
    redirect(`/purchasing/purchase-returns/${result.id}`);
  }
  return { ok: false, message: result.ok ? "Purchase return saved." : result.message };
}
export async function postPurchaseReturnAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const id = String(formData.get("id") ?? "");
  const result = await postPurchaseReturn(actor, id, repository);
  if (result.ok) refresh(id);
  return {
    ok: result.ok,
    message: result.ok
      ? "Purchase return posted; quarantine stock left factory custody."
      : result.message,
  };
}
export async function cancelPurchaseReturnAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const id = String(formData.get("id") ?? "");
  const result = await cancelPurchaseReturn(
    actor,
    id,
    String(formData.get("reason") ?? ""),
    repository,
  );
  if (result.ok) refresh(id);
  return {
    ok: result.ok,
    message: result.ok ? "Draft purchase return cancelled." : result.message,
  };
}
export async function quarantinePurchasedMaterialAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const result = await quarantinePurchasedMaterial(actor, Object.fromEntries(formData), repository);
  if (result.ok) {
    revalidatePath("/purchasing/purchase-returns");
    revalidatePath("/purchasing/purchase-returns/new");
    revalidatePath("/inventory/stock-overview");
    revalidatePath("/inventory/stock-movements");
  }
  return {
    ok: result.ok,
    message: result.ok ? "Purchased material moved from available to quarantine." : result.message,
  };
}
function refresh(id: string) {
  revalidatePath("/purchasing/purchase-returns");
  revalidatePath(`/purchasing/purchase-returns/${id}`);
  revalidatePath("/purchasing/goods-receiving");
  revalidatePath("/purchasing/purchase-orders");
  revalidatePath("/purchasing/suppliers");
  revalidatePath("/inventory/stock-overview");
  revalidatePath("/inventory/stock-movements");
}
