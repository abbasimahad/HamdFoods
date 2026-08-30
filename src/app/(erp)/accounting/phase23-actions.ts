"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  cancelExpenseVoucher,
  postExpenseVoucher,
  reverseExpenseVoucher,
  saveExpenseVoucher,
} from "@/modules/accounting/application/manage-expenses";
import {
  allocateSupplierPayment,
  cancelSupplierPayment,
  postSupplierPayment,
  reverseSupplierPayment,
  saveSupplierPayment,
} from "@/modules/accounting/application/manage-supplier-payments";
import {
  cancelTreasuryTransfer,
  createTreasuryAccount,
  postTreasuryTransfer,
  reverseTreasuryTransfer,
  saveTreasuryTransfer,
} from "@/modules/accounting/application/manage-treasury";
import { PrismaExpenseRepository } from "@/server/accounting/prisma-expense-repository";
import { requirePermission } from "@/server/auth/server-guards";
import { Phase23AccountingError } from "@/server/accounting/prisma-phase23-repository";
import { PrismaSupplierPaymentRepository } from "@/server/accounting/prisma-supplier-payment-repository";
import { PrismaTreasuryRepository } from "@/server/accounting/prisma-treasury-repository";

type Result = { ok: true; message: string } | { ok: false; message: string };
const supplierPaymentRepository = new PrismaSupplierPaymentRepository();
const expenseRepository = new PrismaExpenseRepository();
const treasuryRepository = new PrismaTreasuryRepository();
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((value) => new Date(`${value}T00:00:00.000Z`));
const optional = (limit: number) =>
  z.preprocess(
    (value) => String(value ?? "").trim() || undefined,
    z.string().max(limit).optional(),
  );
const allocations = z
  .array(z.object({ payableLedgerEntryId: z.string().uuid(), allocatedAmount: z.string().max(30) }))
  .max(200);
const expenseLines = z
  .array(
    z.object({
      expenseAccountId: z.string().uuid(),
      description: z.string().trim().min(1).max(500),
      amount: z.string().max(30),
    }),
  )
  .min(1)
  .max(100);

export async function createTreasuryAccountAction(
  _: Result | undefined,
  form: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const parsed = z
    .object({
      code: z.string().trim().min(1).max(30),
      name: z.string().trim().min(1).max(160),
      accountType: z.enum(["CASH", "BANK", "PETTY_CASH", "CLEARING"]),
      glAccountId: z.string().uuid(),
      bankName: optional(160),
      accountTitle: optional(160),
      accountNumberMasked: optional(120),
      branch: optional(120),
      notes: optional(1000),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Treasury account details are invalid." };
  try {
    await createTreasuryAccount(actor, parsed.data, treasuryRepository);
    revalidatePath("/accounting/cash-bank-accounts");
    return { ok: true, message: "Treasury account created." };
  } catch (error) {
    return failure(error);
  }
}

export async function saveSupplierPaymentAction(
  _: Result | undefined,
  form: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const parsed = z
    .object({
      supplierId: z.string().uuid(),
      paymentDate: day,
      treasuryAccountId: z.string().uuid(),
      method: z.enum(["CASH", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"]),
      totalAmount: z.string().max(30),
      referenceNumber: optional(120),
      bankReference: optional(160),
      chequeNumber: optional(120),
      chequeDate: z.preprocess((value) => value || undefined, day.optional()),
      notes: optional(1000),
      allocationsJson: z.string(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Supplier payment details are invalid." };
  try {
    await saveSupplierPayment(
      actor,
      { ...parsed.data, allocations: decode(parsed.data.allocationsJson, allocations) },
      supplierPaymentRepository,
    );
    revalidatePath("/purchasing/supplier-payments");
    return { ok: true, message: "Supplier payment draft saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function postSupplierPaymentAction(
  _: Result | undefined,
  form: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { ok: false, message: "Supplier payment is invalid." };
  try {
    await postSupplierPayment(actor, id.data, supplierPaymentRepository);
    revalidatePath("/purchasing/supplier-payments");
    revalidatePath("/accounting/reconciliation");
    return { ok: true, message: "Supplier payment posted." };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelSupplierPaymentAction(
  _: Result | undefined,
  form: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const parsed = documentAction.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Supplier payment cancellation is invalid." };
  try {
    await cancelSupplierPayment(
      actor,
      parsed.data.id,
      parsed.data.reason,
      supplierPaymentRepository,
    );
    revalidatePath("/purchasing/supplier-payments");
    revalidatePath(`/purchasing/supplier-payments/${parsed.data.id}`);
    return { ok: true, message: "Supplier payment draft cancelled." };
  } catch (error) {
    return failure(error);
  }
}

export async function allocateSupplierPaymentAction(
  _: Result | undefined,
  form: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { ok: false, message: "Supplier payment is invalid." };
  try {
    await allocateSupplierPayment(
      actor,
      id.data,
      decode(String(form.get("allocationsJson") ?? "[]"), allocations),
      supplierPaymentRepository,
    );
    revalidatePath(`/purchasing/supplier-payments/${id.data}`);
    revalidatePath("/purchasing/supplier-payments");
    return { ok: true, message: "Supplier advance allocated without a second GL posting." };
  } catch (error) {
    return failure(error);
  }
}

export async function reverseSupplierPaymentAction(
  _: Result | undefined,
  form: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const parsed = reversalAction.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Supplier payment reversal is invalid." };
  try {
    const reversalId = await reverseSupplierPayment(
      actor,
      parsed.data.id,
      parsed.data.reversalDate,
      parsed.data.reason,
      supplierPaymentRepository,
    );
    revalidatePath("/purchasing/supplier-payments");
    revalidatePath(`/purchasing/supplier-payments/${parsed.data.id}`);
    revalidatePath(`/purchasing/supplier-payments/${reversalId}`);
    revalidatePath("/accounting/cash-bank-accounts");
    revalidatePath("/accounting/reconciliation");
    return { ok: true, message: "Supplier payment reversed through a linked opposite journal." };
  } catch (error) {
    return failure(error);
  }
}

export async function saveExpenseVoucherAction(
  _: Result | undefined,
  form: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const parsed = z
    .object({
      expenseDate: day,
      payee: optional(160),
      supplierId: z.preprocess((value) => value || undefined, z.string().uuid().optional()),
      treasuryAccountId: z.string().uuid(),
      description: z.string().trim().min(1).max(500),
      referenceNumber: optional(120),
      notes: optional(1000),
      linesJson: z.string(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Expense voucher details are invalid." };
  try {
    await saveExpenseVoucher(
      actor,
      { ...parsed.data, lines: decode(parsed.data.linesJson, expenseLines) },
      expenseRepository,
    );
    revalidatePath("/accounting/expenses");
    return { ok: true, message: "Expense voucher draft saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function postExpenseVoucherAction(
  _: Result | undefined,
  form: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { ok: false, message: "Expense voucher is invalid." };
  try {
    await postExpenseVoucher(actor, id.data, expenseRepository);
    revalidatePath("/accounting/expenses");
    revalidatePath("/accounting/cash-bank-accounts");
    return { ok: true, message: "Expense voucher posted." };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelExpenseVoucherAction(
  _: Result | undefined,
  form: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const parsed = documentAction.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Expense cancellation is invalid." };
  try {
    await cancelExpenseVoucher(actor, parsed.data.id, parsed.data.reason, expenseRepository);
    revalidatePath("/accounting/expenses");
    revalidatePath(`/accounting/expenses/${parsed.data.id}`);
    return { ok: true, message: "Expense voucher draft cancelled." };
  } catch (error) {
    return failure(error);
  }
}

export async function reverseExpenseVoucherAction(
  _: Result | undefined,
  form: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const parsed = z
    .object({ id: z.string().uuid(), reversalDate: day, reason: z.string().trim().min(1).max(500) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Expense reversal is invalid." };
  try {
    const reversalId = await reverseExpenseVoucher(
      actor,
      parsed.data.id,
      parsed.data.reversalDate,
      parsed.data.reason,
      expenseRepository,
    );
    revalidatePath("/accounting/expenses");
    revalidatePath(`/accounting/expenses/${parsed.data.id}`);
    revalidatePath(`/accounting/expenses/${reversalId}`);
    revalidatePath("/accounting/cash-bank-accounts");
    revalidatePath("/accounting/reconciliation");
    return { ok: true, message: "Expense voucher reversed through a linked opposite journal." };
  } catch (error) {
    return failure(error);
  }
}

export async function saveTreasuryTransferAction(
  _: Result | undefined,
  form: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const parsed = z
    .object({
      sourceTreasuryAccountId: z.string().uuid(),
      destinationTreasuryAccountId: z.string().uuid(),
      transferDate: day,
      amount: z.string().max(30),
      referenceNumber: optional(120),
      notes: optional(1000),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Transfer details are invalid." };
  try {
    await saveTreasuryTransfer(actor, parsed.data, treasuryRepository);
    revalidatePath("/accounting/transfers");
    return { ok: true, message: "Transfer draft saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function postTreasuryTransferAction(
  _: Result | undefined,
  form: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { ok: false, message: "Transfer is invalid." };
  try {
    await postTreasuryTransfer(actor, id.data, treasuryRepository);
    revalidatePath("/accounting/transfers");
    revalidatePath("/accounting/cash-bank-accounts");
    return { ok: true, message: "Transfer posted." };
  } catch (error) {
    return failure(error);
  }
}
export async function cancelTreasuryTransferAction(
  _: Result | undefined,
  form: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const parsed = documentAction.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Transfer cancellation is invalid." };
  try {
    await cancelTreasuryTransfer(actor, parsed.data.id, parsed.data.reason, treasuryRepository);
    revalidatePath("/accounting/transfers");
    return { ok: true, message: "Treasury transfer draft cancelled." };
  } catch (error) {
    return failure(error);
  }
}
export async function reverseTreasuryTransferAction(
  _: Result | undefined,
  form: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const parsed = reversalAction.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Treasury transfer reversal is invalid." };
  try {
    const reversalId = await reverseTreasuryTransfer(
      actor,
      parsed.data.id,
      parsed.data.reversalDate,
      parsed.data.reason,
      treasuryRepository,
    );
    revalidatePath("/accounting/transfers");
    revalidatePath(`/accounting/transfers/${parsed.data.id}`);
    revalidatePath(`/accounting/transfers/${reversalId}`);
    revalidatePath("/accounting/cash-bank-accounts");
    return { ok: true, message: "Treasury transfer reversed through a linked opposite journal." };
  } catch (error) {
    return failure(error);
  }
}
const documentAction = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});
const reversalAction = z.object({
  id: z.string().uuid(),
  reversalDate: day,
  reason: z.string().trim().min(1).max(500),
});
function decode<T>(value: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    throw new Phase23AccountingError("Allocation or line JSON is invalid.");
  }
}
function failure(error: unknown): Result {
  return {
    ok: false,
    message: error instanceof Error ? error.message : "Accounting action could not complete.",
  };
}
