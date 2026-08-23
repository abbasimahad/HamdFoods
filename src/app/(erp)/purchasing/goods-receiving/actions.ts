"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PurchasingActionState } from "@/components/purchasing/action-state";
import {
  cancelGoodsReceipt,
  completeGoodsReceiptQc,
  postGoodsReceipt,
  saveGoodsReceipt,
} from "@/modules/purchasing/application/manage-goods-receipts";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaGoodsReceiptRepository } from "@/server/purchasing/prisma-goods-receipt-repository";
const repository = new PrismaGoodsReceiptRepository();
export async function saveGoodsReceiptAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const result = await saveGoodsReceipt(actor, Object.fromEntries(formData), repository);
  if (result.ok && result.id) {
    refresh(result.id);
    redirect(`/purchasing/goods-receiving/${result.id}`);
  }
  return { ok: false, message: result.ok ? "Goods receipt saved." : result.message };
}
export async function postGoodsReceiptAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const id = String(formData.get("id") ?? "");
  const result = await postGoodsReceipt(actor, id, repository);
  if (result.ok) refresh(id);
  return {
    ok: result.ok,
    message: result.ok ? "Goods receipt posted to quality hold." : result.message,
  };
}
export async function cancelGoodsReceiptAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const id = String(formData.get("id") ?? "");
  const result = await cancelGoodsReceipt(
    actor,
    id,
    String(formData.get("reason") ?? ""),
    repository,
  );
  if (result.ok) refresh(id);
  return { ok: result.ok, message: result.ok ? "Draft goods receipt cancelled." : result.message };
}
export async function completeGoodsReceiptQcAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const id = String(formData.get("id") ?? "");
  const result = await completeGoodsReceiptQc(actor, id, Object.fromEntries(formData), repository);
  if (result.ok) {
    refresh(id);
    redirect(`/purchasing/goods-receiving/${id}`);
  }
  return { ok: false, message: result.ok ? "QC completed." : result.message };
}
function refresh(id: string) {
  revalidatePath("/purchasing/goods-receiving");
  revalidatePath(`/purchasing/goods-receiving/${id}`);
  revalidatePath("/purchasing/purchase-orders");
  revalidatePath("/inventory/stock-overview");
  revalidatePath("/inventory/stock-movements");
}
