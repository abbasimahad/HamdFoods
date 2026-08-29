"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  saveSalesInvoice,
  postSalesInvoice,
  cancelSalesInvoice,
} from "@/modules/sales/application/manage-sales-invoices";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesInvoiceRepository } from "@/server/sales/prisma-sales-invoice-repository";
const repo = new PrismaSalesInvoiceRepository();
const refresh = (id?: string) => {
  revalidatePath("/sales/invoices");
  revalidatePath("/sales/dispatches");
  if (id) revalidatePath(`/sales/invoices/${id}`);
};
export async function saveInvoiceAction(_: { ok: boolean; message: string }, form: FormData) {
  const r = await saveSalesInvoice(
    await requirePermission("sales.manage"),
    Object.fromEntries(form),
    repo,
  );
  if (r.ok && r.id) {
    refresh(r.id);
    redirect(`/sales/invoices/${r.id}`);
  }
  return { ok: false, message: r.ok ? "Saved." : r.message };
}
export async function postInvoiceAction(_: { ok: boolean; message: string }, form: FormData) {
  const id = String(form.get("id") ?? "");
  const r = await postSalesInvoice(await requirePermission("sales.manage"), id, repo);
  if (r.ok) refresh(id);
  return { ok: r.ok, message: r.ok ? "Invoice posted." : r.message };
}
export async function cancelInvoiceAction(_: { ok: boolean; message: string }, form: FormData) {
  const id = String(form.get("id") ?? "");
  const r = await cancelSalesInvoice(
    await requirePermission("sales.manage"),
    id,
    String(form.get("reason") ?? ""),
    repo,
  );
  if (r.ok) refresh(id);
  return { ok: r.ok, message: r.ok ? "Draft cancelled." : r.message };
}
export async function postInvoiceFormAction(form: FormData): Promise<void> {
  await postInvoiceAction({ ok: false, message: "" }, form);
}
export async function cancelInvoiceFormAction(form: FormData): Promise<void> {
  await cancelInvoiceAction({ ok: false, message: "" }, form);
}
