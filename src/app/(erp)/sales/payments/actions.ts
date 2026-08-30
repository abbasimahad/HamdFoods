"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  allocateCustomerCredit,
  cancelCustomerPayment,
  postCustomerPayment,
  reverseCustomerPayment,
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
export async function reverseCustomerPaymentAction(
  _: { ok: boolean; message: string },
  form: FormData,
) {
  const id = String(form.get("id") ?? "");
  let date: Date;
  try {
    date = reversalDate(String(form.get("reversalDate") ?? ""));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Reversal is invalid." };
  }
  const result = await reverseCustomerPayment(
    await requirePermission("sales.manage"),
    id,
    date,
    String(form.get("reason") ?? ""),
    repository,
  );
  if (typeof result === "string") {
    refresh(id, String(form.get("customerId") ?? ""));
    refresh(result, String(form.get("customerId") ?? ""));
    return { ok: true, message: "Customer payment reversed." };
  }
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, message: "Customer payment reversed." };
}
export async function postCustomerPaymentFormAction(form: FormData): Promise<void> {
  await postCustomerPaymentAction({ ok: false, message: "" }, form);
}
export async function cancelCustomerPaymentFormAction(form: FormData): Promise<void> {
  await cancelCustomerPaymentAction({ ok: false, message: "" }, form);
}
export async function reverseCustomerPaymentFormAction(form: FormData): Promise<void> {
  await reverseCustomerPaymentAction({ ok: false, message: "" }, form);
}
function reversalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Reversal date is invalid.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
    throw new Error("Reversal date is invalid.");
  return date;
}
