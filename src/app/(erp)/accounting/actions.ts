"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type AccountingMappingKey } from "@/generated/prisma/client";
import { requirePermission } from "@/server/auth/server-guards";
import { prisma } from "@/server/db/prisma";
import { recordAuditEvent } from "@/server/audit/audit-event";
import {
  closeAccountingPeriod,
  PeriodCloseError,
  reopenAccountingPeriod,
} from "@/server/accounting/period-close";
import {
  AccountingPostingError,
  backfillAccounting,
  createManualJournalDraft,
  postManualJournal,
  reverseManualJournal,
} from "@/server/accounting/transactional-accounting-posting";

type Result = { ok: true } | { ok: false; message: string };
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

export async function createAccountingPeriodAction(
  _: Result | undefined,
  formData: FormData,
): Promise<Result> {
  await requirePermission("accounting.manage");
  const parsed = z
    .object({ name: z.string().trim().min(1).max(80), startDate: date, endDate: date })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success || parsed.data.startDate > parsed.data.endDate)
    return { ok: false, message: "Provide a valid non-empty period date range." };
  const overlap = await prisma.accountingPeriod.findFirst({
    where: { startDate: { lte: parsed.data.endDate }, endDate: { gte: parsed.data.startDate } },
  });
  if (overlap) return { ok: false, message: "Accounting periods cannot overlap." };
  await prisma.accountingPeriod.create({
    data: {
      id: crypto.randomUUID(),
      name: parsed.data.name,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
    },
  });
  revalidatePath("/accounting");
  revalidatePath("/accounting/settings");
  return { ok: true };
}

export async function postManualJournalAction(
  _: Result | undefined,
  formData: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const parsed = z
    .object({ date, description: z.string().trim().min(1).max(500), lines: z.string().min(2) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Manual journal details are invalid." };
  try {
    const lines = z
      .array(
        z.object({
          accountId: z.string().uuid(),
          debit: z.string().optional(),
          credit: z.string().optional(),
          description: z.string().optional(),
        }),
      )
      .min(2)
      .parse(JSON.parse(parsed.data.lines))
      .map((line) => ({
        accountId: line.accountId,
        ...(line.debit === undefined ? {} : { debit: line.debit }),
        ...(line.credit === undefined ? {} : { credit: line.credit }),
        ...(line.description === undefined ? {} : { description: line.description }),
      }));
    await prisma.$transaction(
      async (tx) => {
        const id = await createManualJournalDraft(tx, {
          accountingDate: parsed.data.date,
          description: parsed.data.description,
          actorUserId: actor.id,
          lines,
        });
        await postManualJournal(tx, id, actor.id);
      },
      { isolationLevel: "Serializable" },
    );
    revalidatePath("/accounting");
    revalidatePath("/accounting/journals");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof AccountingPostingError || error instanceof Error
          ? error.message
          : "Manual journal could not be posted.",
    };
  }
}

export async function reverseManualJournalAction(
  _: Result | undefined,
  formData: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const parsed = z
    .object({ journalId: z.string().uuid(), date, reason: z.string().trim().min(1).max(500) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Reversal details are invalid." };
  try {
    await prisma.$transaction(
      (tx) =>
        reverseManualJournal(
          tx,
          parsed.data.journalId,
          parsed.data.date,
          parsed.data.reason,
          actor.id,
        ),
      { isolationLevel: "Serializable" },
    );
    revalidatePath("/accounting/journals");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Journal could not be reversed.",
    };
  }
}

export async function backfillAccountingAction(): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  try {
    await prisma.$transaction((tx) => backfillAccounting(tx, actor.id), {
      isolationLevel: "Serializable",
    });
    revalidatePath("/accounting");
    revalidatePath("/accounting/journals");
    revalidatePath("/accounting/reconciliation");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Accounting backfill could not run.",
    };
  }
}

export async function updateAccountingSettingsAction(
  _: Result | undefined,
  formData: FormData,
): Promise<Result> {
  await requirePermission("accounting.manage");
  const parsed = z
    .object({
      purchaseTaxTreatment: z.enum(["RECOVERABLE", "CAPITALIZE", "EXPENSE", "NOT_CONFIGURED"]),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Accounting settings are invalid." };
  await prisma.accountingSettings.update({
    where: { id: "default" },
    data: { purchaseTaxTreatment: parsed.data.purchaseTaxTreatment },
  });
  revalidatePath("/accounting");
  revalidatePath("/accounting/settings");
  return { ok: true };
}

export async function setAccountingPeriodStatusAction(
  _: Result | undefined,
  formData: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const parsed = z
    .object({
      periodId: z.string().uuid(),
      status: z.enum(["OPEN", "CLOSED"]),
      reason: z.string().trim().max(500).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Period request is invalid." };
  try {
    if (parsed.data.status === "CLOSED")
      await closeAccountingPeriod(parsed.data.periodId, actor.id);
    else await reopenAccountingPeriod(parsed.data.periodId, actor.id, parsed.data.reason ?? "");
    revalidatePath("/accounting");
    revalidatePath("/accounting/settings");
    revalidatePath("/accounting/reports");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof PeriodCloseError || error instanceof Error
          ? error.message
          : "Period status could not be changed.",
    };
  }
}

export async function updateAccountMappingAction(
  _: Result | undefined,
  formData: FormData,
): Promise<Result> {
  const actor = await requirePermission("accounting.manage");
  const parsed = z
    .object({ mappingKey: z.string().min(1), accountId: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Account mapping is invalid." };
  const account = await prisma.accountingAccount.findUnique({
    where: { id: parsed.data.accountId },
  });
  if (!account || !account.active || !account.postingAllowed)
    return { ok: false, message: "Mappings require an active posting account." };
  const previous = await prisma.accountingAccountMapping.findUnique({
    where: {
      accountingSettingsId_mappingKey: {
        accountingSettingsId: "default",
        mappingKey: parsed.data.mappingKey as AccountingMappingKey,
      },
    },
    include: { account: true },
  });
  const updated = await prisma.accountingAccountMapping.update({
    where: {
      accountingSettingsId_mappingKey: {
        accountingSettingsId: "default",
        mappingKey: parsed.data.mappingKey as AccountingMappingKey,
      },
    },
    data: { accountId: account.id },
  });
  await recordAuditEvent(prisma, {
    actorUserId: actor.id,
    action: "UPDATE",
    entityType: "MASTER_DATA",
    entityId: updated.id,
    entityReference: parsed.data.mappingKey,
    module: "accounting",
    description: `Updated accounting mapping ${parsed.data.mappingKey}.`,
    beforeSnapshot: {
      accountId: previous?.accountId ?? null,
      accountCode: previous?.account.code ?? null,
    },
    afterSnapshot: { accountId: account.id, accountCode: account.code },
    controlEvent: true,
  });
  revalidatePath("/accounting/settings");
  return { ok: true };
}

export async function setAccountingAccountActiveAction(
  _: Result | undefined,
  formData: FormData,
): Promise<Result> {
  await requirePermission("accounting.manage");
  const parsed = z
    .object({ accountId: z.string().uuid(), active: z.enum(["true", "false"]) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Account update is invalid." };
  const active = parsed.data.active === "true";
  const account = await prisma.accountingAccount.findUnique({
    where: { id: parsed.data.accountId },
    include: { mappings: true },
  });
  if (!account) return { ok: false, message: "Account was not found." };
  if (!active && account.mappings.length)
    return { ok: false, message: "Remap this account before deactivating it." };
  await prisma.accountingAccount.update({ where: { id: account.id }, data: { active } });
  revalidatePath("/accounting/chart-of-accounts");
  revalidatePath("/accounting/settings");
  return { ok: true };
}

export async function createAccountingAccountAction(
  _: Result | undefined,
  formData: FormData,
): Promise<Result> {
  await requirePermission("accounting.manage");
  const parsed = z
    .object({
      code: z.string().trim().min(1).max(30),
      name: z.string().trim().min(1).max(160),
      accountType: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
      subtype: z.string().trim().max(80).optional(),
      parentAccountId: z.preprocess((value) => value || undefined, z.string().uuid().optional()),
      postingAllowed: z.enum(["true", "false"]),
      isControl: z.enum(["true", "false"]),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Account details are invalid." };
  if (parsed.data.parentAccountId) {
    const parent = await prisma.accountingAccount.findUnique({
      where: { id: parsed.data.parentAccountId },
    });
    if (!parent || parent.accountType !== parsed.data.accountType)
      return { ok: false, message: "The parent account must have the same account type." };
  }
  try {
    await prisma.accountingAccount.create({
      data: {
        code: parsed.data.code,
        name: parsed.data.name,
        accountType: parsed.data.accountType,
        subtype: parsed.data.subtype || null,
        parentAccountId: parsed.data.parentAccountId || null,
        postingAllowed: parsed.data.postingAllowed === "true",
        isControl: parsed.data.isControl === "true",
      },
    });
    revalidatePath("/accounting/chart-of-accounts");
    revalidatePath("/accounting/settings");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.message.includes("Unique constraint")
          ? "Account code already exists."
          : "Account could not be created.",
    };
  }
}
