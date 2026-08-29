"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SalesDispatchActionState } from "@/components/sales/sales-dispatch-action-state";
import {
  cancelSalesDispatch,
  confirmSalesDispatchDelivery,
  postSalesDispatch,
  saveSalesDispatch,
} from "@/modules/sales/application/manage-sales-dispatches";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesDispatchRepository } from "@/server/sales/prisma-sales-dispatch-repository";
const repository = new PrismaSalesDispatchRepository();
function refresh(id?: string) {
  revalidatePath("/sales");
  revalidatePath("/sales/orders");
  revalidatePath("/sales/dispatches");
  if (id) {
    revalidatePath(`/sales/dispatches/${id}`);
    revalidatePath(`/sales/dispatches/${id}/print`);
  }
}
export async function saveSalesDispatchAction(
  _: SalesDispatchActionState,
  formData: FormData,
): Promise<SalesDispatchActionState> {
  const actor = await requirePermission("sales.manage");
  const result = await saveSalesDispatch(actor, Object.fromEntries(formData), repository);
  if (result.ok && result.id) {
    refresh(result.id);
    redirect(`/sales/dispatches/${result.id}`);
  }
  return { ok: false, message: result.ok ? "Dispatch saved." : result.message };
}
export async function postSalesDispatchAction(
  _: SalesDispatchActionState,
  formData: FormData,
): Promise<SalesDispatchActionState> {
  const actor = await requirePermission("sales.manage");
  const id = String(formData.get("id") ?? "");
  const result = await postSalesDispatch(actor, id, repository);
  if (result.ok) refresh(id);
  return {
    ok: result.ok,
    message: result.ok ? "Dispatch posted; reserved stock moved to in transit." : result.message,
  };
}
export async function confirmSalesDispatchDeliveryAction(
  _: SalesDispatchActionState,
  formData: FormData,
): Promise<SalesDispatchActionState> {
  const actor = await requirePermission("sales.manage");
  const id = String(formData.get("id") ?? "");
  const result = await confirmSalesDispatchDelivery(
    actor,
    id,
    String(formData.get("receiverName") ?? ""),
    String(formData.get("notes") ?? ""),
    repository,
  );
  if (result.ok) refresh(id);
  return {
    ok: result.ok,
    message: result.ok
      ? "Delivery confirmed; inventory remains in transit until the next sales phase."
      : result.message,
  };
}
export async function cancelSalesDispatchAction(
  _: SalesDispatchActionState,
  formData: FormData,
): Promise<SalesDispatchActionState> {
  const actor = await requirePermission("sales.manage");
  const id = String(formData.get("id") ?? "");
  const result = await cancelSalesDispatch(
    actor,
    id,
    String(formData.get("reason") ?? ""),
    repository,
  );
  if (result.ok) refresh(id);
  return { ok: result.ok, message: result.ok ? "Draft dispatch cancelled." : result.message };
}
