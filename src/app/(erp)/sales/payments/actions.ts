"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  allocateCustomerCredit,
  cancelCustomerPayment,
  postCustomerPayment,
  saveCustomerPayment,
} from "@/modules/sales/application/manage-customer-payments";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaCustomerPaymentRepository } from "@/server/sales/prisma-customer-payment-repository";

const repository = new PrismaCustomerPaymentRepository();
const refresh = (id?: string, customerId?: string) => {
  revalidatePath("/sales/payments");
  revalidatePath("/sales/invoices");
  if (id) revalidatePath(`/sales/payments/${id}`);
  if (customerId) {
    revalidatePath(`/sales/customers/${customerId}`);
    revalidatePath(`/sales/customers/${customerId}/statement`);
  }
};
export async function saveCustomerPaymentAction(
  _: { ok: boolean; message: string },
  form: FormData,
) {
  const result = await saveCustomerPayment(
    await requirePermission("sales.manage"),
    Object.fromEntries(form),
    repository,
  );
  if (result.ok && result.id) {
    refresh(result.id, String(form.get("customerId") ?? ""));
    redirect(`/sales/payments/${result.id}`);
  }
  return { ok: false, message: result.ok ? "Saved." : result.message };
}
export async function postCustomerPaymentAction(
  _: { ok: boolean; message: string },
  form: FormData,
) {
  const id = String(form.get("id") ?? "");
  const result = await postCustomerPayment(await requirePermission("sales.manage"), id, repository);
  if (result.ok) refresh(id, String(form.get("customerId") ?? ""));
  return { ok: result.ok, message: result.ok ? "Payment posted." : result.message };
}
export async function cancelCustomerPaymentAction(
  _: { ok: boolean; message: string },
  form: FormData,
) {
  const id = String(form.get("id") ?? "");
  const result = await cancelCustomerPayment(
    await requirePermission("sales.manage"),
    id,
    String(form.get("reason") ?? ""),
    repository,
  );
  if (result.ok) refresh(id, String(form.get("customerId") ?? ""));
  return { ok: result.ok, message: result.ok ? "Draft cancelled." : result.message };
}
export async function allocateCustomerCreditAction(
  _: { ok: boolean; message: string },
  form: FormData,
) {
  const id = String(form.get("id") ?? "");
  const result = await allocateCustomerCredit(
    await requirePermission("sales.manage"),
    id,
    Object.fromEntries(form),
    repository,
  );
  if (result.ok) refresh(id, String(form.get("customerId") ?? ""));
  return { ok: result.ok, message: result.ok ? "Customer credit allocated." : result.message };
}
export async function postCustomerPaymentFormAction(form: FormData): Promise<void> {
  await postCustomerPaymentAction({ ok: false, message: "" }, form);
}
export async function cancelCustomerPaymentFormAction(form: FormData): Promise<void> {
  await cancelCustomerPaymentAction({ ok: false, message: "" }, form);
}
