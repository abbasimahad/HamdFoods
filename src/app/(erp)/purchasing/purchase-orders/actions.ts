"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PurchasingActionState } from "@/components/purchasing/action-state";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  savePurchaseOrder,
} from "@/modules/purchasing/application/manage-purchase-orders";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchasingRepository } from "@/server/purchasing/prisma-purchasing-repository";

const repository = new PrismaPurchasingRepository();

export async function savePurchaseOrderAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const result = await savePurchaseOrder(actor, Object.fromEntries(formData), repository);
  if (result.ok && result.id) {
    revalidatePath("/purchasing/purchase-orders");
    redirect(`/purchasing/purchase-orders/${result.id}`);
  }
  return { ok: false, message: result.ok ? "Purchase order saved." : result.message };
}
export async function approvePurchaseOrderAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const id = String(formData.get("id") ?? "");
  const result = await approvePurchaseOrder(actor, id, repository);
  if (result.ok) {
    revalidatePath("/purchasing/purchase-orders");
    revalidatePath(`/purchasing/purchase-orders/${id}`);
  }
  return { ok: result.ok, message: result.ok ? "Purchase order approved." : result.message };
}
export async function cancelPurchaseOrderAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const id = String(formData.get("id") ?? "");
  const result = await cancelPurchaseOrder(
    actor,
    id,
    String(formData.get("reason") ?? ""),
    repository,
  );
  if (result.ok) {
    revalidatePath("/purchasing/purchase-orders");
    revalidatePath(`/purchasing/purchase-orders/${id}`);
  }
  return { ok: result.ok, message: result.ok ? "Purchase order cancelled." : result.message };
}
