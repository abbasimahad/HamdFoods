"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SalesOrderActionState } from "@/components/sales/sales-order-action-state";
import {
  approveSalesOrder,
  cancelSalesOrder,
  reserveRedeliveryStock,
  saveSalesOrder,
} from "@/modules/sales/application/manage-sales-orders";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesOrderRepository } from "@/server/sales/prisma-sales-order-repository";

const repository = new PrismaSalesOrderRepository();
const refresh = (id?: string) => {
  revalidatePath("/sales");
  revalidatePath("/sales/orders");
  if (id) {
    revalidatePath(`/sales/orders/${id}`);
    revalidatePath(`/sales/orders/${id}/print`);
  }
};
export async function saveSalesOrderAction(
  _: SalesOrderActionState,
  formData: FormData,
): Promise<SalesOrderActionState> {
  const actor = await requirePermission("sales.manage");
  const result = await saveSalesOrder(actor, Object.fromEntries(formData), repository);
  if (result.ok && result.id) {
    refresh(result.id);
    redirect(`/sales/orders/${result.id}`);
  }
  return { ok: false, message: result.ok ? "Sales order saved." : result.message };
}
export async function approveSalesOrderAction(
  _: SalesOrderActionState,
  formData: FormData,
): Promise<SalesOrderActionState> {
  const actor = await requirePermission("sales.manage");
  const id = String(formData.get("id") ?? "");
  const result = await approveSalesOrder(actor, id, repository);
  if (result.ok) refresh(id);
  return {
    ok: result.ok,
    message: result.ok ? "Sales order approved and stock reserved." : result.message,
  };
}
export async function reserveRedeliveryStockAction(
  _: SalesOrderActionState,
  formData: FormData,
): Promise<SalesOrderActionState> {
  const actor = await requirePermission("sales.manage");
  const id = String(formData.get("id") ?? "");
  const result = await reserveRedeliveryStock(actor, id, repository);
  if (result.ok) refresh(id);
  return {
    ok: result.ok,
    message: result.ok
      ? "Redelivery stock reserved explicitly from available stock."
      : result.message,
  };
}
export async function cancelSalesOrderAction(
  _: SalesOrderActionState,
  formData: FormData,
): Promise<SalesOrderActionState> {
  const actor = await requirePermission("sales.manage");
  const id = String(formData.get("id") ?? "");
  const result = await cancelSalesOrder(
    actor,
    id,
    String(formData.get("reason") ?? ""),
    repository,
  );
  if (result.ok) refresh(id);
  return {
    ok: result.ok,
    message: result.ok
      ? "Sales order cancelled; reservation released where applicable."
      : result.message,
  };
}
