"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PurchasingActionState } from "@/components/purchasing/action-state";
import {
  cancelPurchaseInvoice,
  postPurchaseInvoice,
  reversePurchaseInvoice,
  savePurchaseInvoice,
} from "@/modules/purchasing/application/manage-purchase-invoices";
import { requirePermission } from "@/server/auth/licensed-guards";
import { PrismaPurchaseInvoiceRepository } from "@/server/purchasing/prisma-purchase-invoice-repository";

const repository = new PrismaPurchaseInvoiceRepository();

export async function savePurchaseInvoiceAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const result = await savePurchaseInvoice(actor, Object.fromEntries(formData), repository);
  if (result.ok && result.id) {
    refresh(result.id);
    redirect(`/purchasing/purchase-invoices/${result.id}`);
  }
  return { ok: false, message: result.ok ? "Purchase invoice saved." : result.message };
}

export async function postPurchaseInvoiceAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const id = String(formData.get("id") ?? "");
  const result = await postPurchaseInvoice(actor, id, repository);
  if (result.ok) refresh(id);
  return {
    ok: result.ok,
    message: result.ok
      ? "Purchase invoice posted; only price/tax variance (if any) affected accounting."
      : result.message,
  };
}

export async function cancelPurchaseInvoiceAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const id = String(formData.get("id") ?? "");
  const result = await cancelPurchaseInvoice(
    actor,
    id,
    String(formData.get("reason") ?? ""),
    repository,
  );
  if (result.ok) refresh(id);
  return {
    ok: result.ok,
    message: result.ok ? "Draft purchase invoice cancelled." : result.message,
  };
}

export async function reversePurchaseInvoiceAction(
  _state: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const actor = await requirePermission("purchasing.manage");
  const id = String(formData.get("id") ?? "");
  const result = await reversePurchaseInvoice(
    actor,
    id,
    String(formData.get("reason") ?? ""),
    repository,
  );
  if (result.ok) refresh(id);
  return { ok: result.ok, message: result.ok ? "Purchase invoice reversed." : result.message };
}

function refresh(id: string) {
  revalidatePath("/purchasing/purchase-invoices");
  revalidatePath(`/purchasing/purchase-invoices/${id}`);
  revalidatePath("/purchasing/purchase-orders");
  revalidatePath("/purchasing/goods-receiving");
  revalidatePath("/purchasing/suppliers");
  revalidatePath("/accounting/payables");
}
