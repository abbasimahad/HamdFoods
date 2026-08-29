"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  cancelSalesReturn,
  completeSalesReturn,
  inspectSalesReturn,
  receiveSalesReturn,
  saveSalesReturn,
} from "@/modules/sales/application/manage-sales-returns";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesReturnRepository } from "@/server/sales/prisma-sales-return-repository";
const repository = new PrismaSalesReturnRepository();
function refresh(id?: string) {
  revalidatePath("/sales/returns");
  revalidatePath("/sales/invoices");
  revalidatePath("/sales/dispatches");
  if (id) revalidatePath(`/sales/returns/${id}`);
}
export async function saveSalesReturnAction(_: { ok: boolean; message: string }, form: FormData) {
  const result = await saveSalesReturn(
    await requirePermission("sales.manage"),
    Object.fromEntries(form),
    repository,
  );
  if (result.ok && result.id) {
    refresh(result.id);
    redirect(`/sales/returns/${result.id}`);
  }
  return { ok: false, message: result.ok ? "Saved." : result.message };
}
export async function receiveSalesReturnAction(
  _: { ok: boolean; message: string },
  form: FormData,
) {
  const id = String(form.get("id") ?? "");
  const result = await receiveSalesReturn(await requirePermission("sales.manage"), id, repository);
  if (result.ok) refresh(id);
  return {
    ok: result.ok,
    message: result.ok ? "Returned goods received into inspection." : result.message,
  };
}
export async function inspectSalesReturnAction(
  _: { ok: boolean; message: string },
  form: FormData,
) {
  const id = String(form.get("id") ?? "");
  const result = await inspectSalesReturn(
    await requirePermission("sales.manage"),
    id,
    Object.fromEntries(form),
    repository,
  );
  if (result.ok) refresh(id);
  return { ok: result.ok, message: result.ok ? "Return inspection completed." : result.message };
}
export async function completeSalesReturnAction(
  _: { ok: boolean; message: string },
  form: FormData,
) {
  const id = String(form.get("id") ?? "");
  const result = await completeSalesReturn(await requirePermission("sales.manage"), id, repository);
  if (result.ok) refresh(id);
  return { ok: result.ok, message: result.ok ? "Customer return credit posted." : result.message };
}
export async function cancelSalesReturnAction(_: { ok: boolean; message: string }, form: FormData) {
  const id = String(form.get("id") ?? "");
  const result = await cancelSalesReturn(
    await requirePermission("sales.manage"),
    id,
    String(form.get("reason") ?? ""),
    repository,
  );
  if (result.ok) refresh(id);
  return { ok: result.ok, message: result.ok ? "Draft return cancelled." : result.message };
}
