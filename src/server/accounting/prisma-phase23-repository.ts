import "server-only";

import Decimal from "decimal.js";
import { type Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import {
  effectiveSupplierPaymentWhere,
  isEffectivePostedPayment,
} from "@/server/accounting/payment-effectiveness";
import { recordAuditEvent } from "@/server/audit/audit-event";
import {
  AccountingPostingError,
  postDirectAccountJournal,
} from "./transactional-accounting-posting";

type Tx = Prisma.TransactionClient;
type AllocationInput = { payableLedgerEntryId: string; allocatedAmount: string };
type ExpenseLineInput = { expenseAccountId: string; description: string; amount: string };

export class Phase23AccountingError extends Error {}

export async function treasuryAccounts() {
  const accounts = await prisma.treasuryAccount.findMany({
    include: { glAccount: true },
    orderBy: { code: "asc" },
  });
  return Promise.all(accounts.map((account) => treasurySummary(prisma, account)));
}

export async function createTreasuryAccount(
  actorUserId: string,
  input: {
    code: string;
    name: string;
    accountType: "CASH" | "BANK" | "PETTY_CASH" | "CLEARING";
    glAccountId: string;
    bankName?: string | undefined;
    accountTitle?: string | undefined;
    accountNumberMasked?: string | undefined;
    branch?: string | undefined;
    notes?: string | undefined;
  },
) {
  return serializable(async (tx) => {
    const account = await tx.accountingAccount.findUnique({ where: { id: input.glAccountId } });
    if (!account || !account.active || !account.postingAllowed || account.accountType !== "ASSET")
      throw new Phase23AccountingError(
        "Treasury accounts require an active posting-enabled ASSET GL account.",
      );
    const created = await tx.treasuryAccount.create({
      data: {
        ...input,
        bankName: input.bankName ?? null,
        accountTitle: input.accountTitle ?? null,
        accountNumberMasked: input.accountNumberMasked ?? null,
        branch: input.branch ?? null,
        notes: input.notes ?? null,
      },
    });
    await recordAuditEvent(tx, {
      actorUserId,
      action: "CREATE",
      entityType: "MASTER_DATA",
      entityId: created.id,
      entityReference: created.code,
      module: "accounting",
      description: `Created treasury account ${created.code}.`,
      metadata: { accountType: created.accountType, glAccountId: created.glAccountId },
      controlEvent: true,
    });
    return created;
  });
}

export async function saveSupplierPayment(
  actorUserId: string,
  input: {
    id?: string | undefined;
    supplierId: string;
    paymentDate: Date;
    treasuryAccountId: string;
    method: "CASH" | "BANK_TRANSFER" | "CHEQUE" | "CARD" | "OTHER";
    totalAmount: string;
    referenceNumber?: string | undefined;
    bankReference?: string | undefined;
    chequeNumber?: string | undefined;
    chequeDate?: Date | undefined;
    notes?: string | undefined;
    allocations: readonly AllocationInput[];
  },
) {
  return serializable(async (tx) => {
    const amount = exactPositive(input.totalAmount, "Payment amount");
    await validateTreasury(tx, input.treasuryAccountId);
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier?.active) throw new Phase23AccountingError("Select an active supplier.");
    const allocations = await prepareAllocations(tx, input.supplierId, input.allocations);
    if (sum(allocations.map((line) => line.allocatedAmount)).gt(amount))
      throw new Phase23AccountingError("Allocated value cannot exceed payment value.");
    const header = {
      supplierId: input.supplierId,
      paymentDate: input.paymentDate,
      treasuryAccountId: input.treasuryAccountId,
      method: input.method,
      totalAmount: amount.toFixed(6),
      referenceNumber: input.referenceNumber ?? null,
      bankReference: input.bankReference ?? null,
      chequeNumber: input.chequeNumber ?? null,
      chequeDate: input.chequeDate ?? null,
      notes: input.notes ?? null,
    };
    if (input.id) {
      const current = await tx.supplierPayment.findUnique({ where: { id: input.id } });
      if (!current || current.status !== "DRAFT")
        throw new Phase23AccountingError("Only draft supplier payments can be edited.");
      await tx.supplierPaymentAllocation.deleteMany({ where: { supplierPaymentId: input.id } });
      await tx.supplierPayment.update({
        where: { id: input.id },
        data: {
          ...header,
          allocations: { create: allocations.map(allocationCreate(actorUserId)) },
        },
      });
      return input.id;
    }
    const number = await nextNumber(tx.supplierPaymentSequence, input.paymentDate, "SPAY");
    return (
      await tx.supplierPayment.create({
        data: {
          number,
          ...header,
          createdByUserId: actorUserId,
          allocations: { create: allocations.map(allocationCreate(actorUserId)) },
        },
      })
    ).id;
  });
}

export async function postSupplierPayment(id: string, actorUserId: string) {
  return serializable(async (tx) => {
    const payment = await tx.supplierPayment.findUnique({
      where: { id },
      include: {
        supplier: true,
        treasuryAccount: { include: { glAccount: true } },
        allocations: true,
      },
    });
    if (!payment || payment.status !== "DRAFT")
      throw new Phase23AccountingError("Only draft supplier payments can be posted.");
    if (!payment.supplier.active) throw new Phase23AccountingError("Supplier is inactive.");
    await validateTreasury(tx, payment.treasuryAccountId);
    const prepared = await prepareAllocations(
      tx,
      payment.supplierId,
      payment.allocations.map((line) => ({
        payableLedgerEntryId: line.payableLedgerEntryId,
        allocatedAmount: line.allocatedAmount.toString(),
      })),
    );
    if (sum(prepared.map((line) => line.allocatedAmount)).gt(payment.totalAmount.toString()))
      throw new Phase23AccountingError("Allocated value cannot exceed payment value.");
    await guardPhysicalCash(
      tx,
      payment.treasuryAccount,
      new Decimal(payment.totalAmount.toString()),
    );
    const apAccountId = await mappedAccount(tx, "ACCOUNTS_PAYABLE");
    const journalId = await postDirectAccountJournal(tx, {
      sourceType: "SUPPLIER_PAYMENT",
      sourceId: payment.id,
      sourceNumber: payment.number,
      accountingDate: payment.paymentDate,
      description: `Supplier payment: ${payment.number}.`,
      actorUserId,
      lines: [
        {
          accountId: apAccountId,
          debit: payment.totalAmount.toString(),
          supplierId: payment.supplierId,
        },
        { accountId: payment.treasuryAccount.glAccountId, credit: payment.totalAmount.toString() },
      ],
    });
    await tx.supplierPayableLedgerEntry.create({
      data: {
        sourceKey: `SUPPLIER_PAYMENT:${payment.id}`,
        supplierId: payment.supplierId,
        entryType: "SUPPLIER_PAYMENT",
        entryDate: payment.paymentDate,
        signedAmount: new Decimal(payment.totalAmount.toString()).negated().toFixed(6),
        sourceType: "SUPPLIER_PAYMENT",
        sourceId: payment.id,
        sourceNumber: payment.number,
        description: `Supplier payment ${payment.number}.`,
        journalId,
      },
    });
    await tx.supplierPayment.update({
      where: { id: payment.id },
      data: { status: "POSTED", postedByUserId: actorUserId, postedAt: new Date() },
    });
    await recordAuditEvent(tx, {
      actorUserId,
      action: "POST",
      entityType: "SUPPLIER_PAYMENT",
      entityId: payment.id,
      entityReference: payment.number,
      module: "accounting",
      description: `Posted supplier payment ${payment.number}.`,
      metadata: {
        totalAmount: payment.totalAmount.toString(),
        allocationCount: payment.allocations.length,
      },
      beforeSnapshot: { status: payment.status },
      afterSnapshot: { status: "POSTED" },
      related: { entityType: "JOURNAL", entityId: journalId },
      controlEvent: true,
    });
  });
}

export async function cancelSupplierPayment(id: string, actorUserId: string, reason: string) {
  return serializable(async (tx) => {
    const payment = await tx.supplierPayment.findUnique({ where: { id } });
    if (!payment || payment.status !== "DRAFT")
      throw new Phase23AccountingError("Only draft supplier payments can be cancelled.");
    await tx.supplierPayment.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledByUserId: actorUserId,
        cancelledAt: new Date(),
        cancellationReason: requiredReason(reason, "Cancellation reason"),
      },
    });
    await recordAuditEvent(tx, {
      actorUserId,
      action: "CANCEL",
      entityType: "SUPPLIER_PAYMENT",
      entityId: payment.id,
      entityReference: payment.number,
      module: "accounting",
      description: `Cancelled draft supplier payment ${payment.number}.`,
      reasonCode: "OTHER",
      reason: requiredReason(reason, "Cancellation reason"),
      controlEvent: true,
    });
  });
}

export async function reverseSupplierPayment(
  id: string,
  actorUserId: string,
  reversalDate: Date,
  reason: string,
) {
  return serializable(async (tx) => {
    const original = await tx.supplierPayment.findUnique({
      where: { id },
      include: {
        treasuryAccount: { include: { glAccount: true } },
        reversalPayment: true,
      },
    });
    if (!original || original.status !== "POSTED")
      throw new Phase23AccountingError("Only posted supplier payments can be reversed.");
    if (original.reversalOfId || original.reversalPayment)
      throw new Phase23AccountingError("This supplier payment already has a reversal.");
    const reversalReason = requiredReason(reason, "Reversal reason");
    await validateTreasury(tx, original.treasuryAccountId);
    const apAccountId = await mappedAccount(tx, "ACCOUNTS_PAYABLE");
    const number = await nextNumber(tx.supplierPaymentSequence, reversalDate, "SPAY");
    const reversal = await tx.supplierPayment.create({
      data: {
        number,
        supplierId: original.supplierId,
        paymentDate: reversalDate,
        treasuryAccountId: original.treasuryAccountId,
        method: original.method,
        totalAmount: original.totalAmount,
        referenceNumber: original.referenceNumber,
        bankReference: original.bankReference,
        chequeNumber: original.chequeNumber,
        chequeDate: original.chequeDate,
        notes: `Reversal of ${original.number}.`,
        status: "POSTED",
        reversalOfId: original.id,
        reversalReason,
        createdByUserId: actorUserId,
        postedByUserId: actorUserId,
        postedAt: new Date(),
      },
    });
    const journalId = await postDirectAccountJournal(tx, {
      sourceType: "SUPPLIER_PAYMENT",
      sourceId: reversal.id,
      sourceNumber: reversal.number,
      accountingDate: reversalDate,
      description: `Supplier-payment reversal: ${original.number}. ${reversalReason}`,
      actorUserId,
      lines: [
        { accountId: original.treasuryAccount.glAccountId, debit: original.totalAmount.toString() },
        {
          accountId: apAccountId,
          credit: original.totalAmount.toString(),
          supplierId: original.supplierId,
        },
      ],
    });
    await tx.supplierPayableLedgerEntry.create({
      data: {
        sourceKey: `SUPPLIER_PAYMENT_REVERSAL:${reversal.id}`,
        supplierId: original.supplierId,
        entryType: "ADJUSTMENT",
        entryDate: reversalDate,
        signedAmount: original.totalAmount,
        sourceType: "SUPPLIER_PAYMENT_REVERSAL",
        sourceId: reversal.id,
        sourceNumber: reversal.number,
        description: `Reversal of supplier payment ${original.number}.`,
        journalId,
      },
    });
    await recordAuditEvent(tx, {
      actorUserId,
      action: "REVERSE",
      entityType: "SUPPLIER_PAYMENT",
      entityId: reversal.id,
      entityReference: reversal.number,
      module: "accounting",
      description: `Reversed supplier payment ${original.number}.`,
      reasonCode: "ACCOUNTING_CORRECTION",
      reason: reversalReason,
      related: {
        entityType: "SUPPLIER_PAYMENT",
        entityId: original.id,
        reference: original.number,
      },
      controlEvent: true,
    });
    return reversal.id;
  });
}

export async function allocatePostedSupplierPayment(
  id: string,
  allocations: readonly AllocationInput[],
  actorUserId: string,
) {
  return serializable(async (tx) => {
    const payment = await tx.supplierPayment.findUnique({
      where: { id },
      include: { allocations: true, reversalPayment: true },
    });
    if (!payment || !isEffectivePostedPayment(payment))
      throw new Phase23AccountingError(
        "Only effective posted supplier-payment advances can be allocated.",
      );
    const additions = await prepareAllocations(tx, payment.supplierId, allocations);
    const alreadyAllocated = sum(payment.allocations.map((line) => line.allocatedAmount));
    if (
      alreadyAllocated
        .add(sum(additions.map((line) => line.allocatedAmount)))
        .gt(payment.totalAmount)
    )
      throw new Phase23AccountingError("Allocation exceeds the payment's unallocated advance.");
    await tx.supplierPaymentAllocation.createMany({
      data: additions
        .map(allocationCreate(actorUserId))
        .map((row) => ({ ...row, supplierPaymentId: payment.id })),
    });
    await recordAuditEvent(tx, {
      actorUserId,
      action: "ALLOCATE",
      entityType: "SUPPLIER_PAYMENT",
      entityId: payment.id,
      entityReference: payment.number,
      module: "accounting",
      description: `Allocated posted supplier payment ${payment.number}.`,
      metadata: {
        allocationCount: additions.length,
        allocatedAmount: sum(additions.map((line) => line.allocatedAmount)).toFixed(6),
        totalAllocatedAfter: alreadyAllocated
          .add(sum(additions.map((line) => line.allocatedAmount)))
          .toFixed(6),
      },
      controlEvent: true,
    });
  });
}

export async function saveExpenseVoucher(
  actorUserId: string,
  input: {
    id?: string | undefined;
    expenseDate: Date;
    payee?: string | undefined;
    supplierId?: string | undefined;
    treasuryAccountId: string;
    description: string;
    referenceNumber?: string | undefined;
    notes?: string | undefined;
    lines: readonly ExpenseLineInput[];
  },
) {
  return serializable(async (tx) => {
    await validateTreasury(tx, input.treasuryAccountId);
    const lines = await validateExpenseLines(tx, input.lines);
    const totalAmount = sum(lines.map((line) => line.amount));
    const header = {
      expenseDate: input.expenseDate,
      payee: input.payee ?? null,
      supplierId: input.supplierId ?? null,
      treasuryAccountId: input.treasuryAccountId,
      description: input.description,
      totalAmount: totalAmount.toFixed(6),
      referenceNumber: input.referenceNumber ?? null,
      notes: input.notes ?? null,
    };
    if (input.id) {
      const current = await tx.expenseVoucher.findUnique({ where: { id: input.id } });
      if (!current || current.status !== "DRAFT")
        throw new Phase23AccountingError("Only draft expenses can be edited.");
      await tx.expenseVoucherLine.deleteMany({ where: { expenseVoucherId: input.id } });
      await tx.expenseVoucher.update({
        where: { id: input.id },
        data: {
          ...header,
          lines: { create: lines.map((line, index) => ({ ...line, position: index + 1 })) },
        },
      });
      return input.id;
    }
    const number = await nextNumber(tx.expenseVoucherSequence, input.expenseDate, "EXP");
    return (
      await tx.expenseVoucher.create({
        data: {
          number,
          ...header,
          createdByUserId: actorUserId,
          lines: { create: lines.map((line, index) => ({ ...line, position: index + 1 })) },
        },
      })
    ).id;
  });
}

export async function postExpenseVoucher(id: string, actorUserId: string) {
  return serializable(async (tx) => {
    const voucher = await tx.expenseVoucher.findUnique({
      where: { id },
      include: { treasuryAccount: { include: { glAccount: true } }, lines: true },
    });
    if (!voucher || voucher.status !== "DRAFT")
      throw new Phase23AccountingError("Only draft expenses can be posted.");
    await validateTreasury(tx, voucher.treasuryAccountId);
    const lines = await validateExpenseLines(
      tx,
      voucher.lines.map((line) => ({
        expenseAccountId: line.expenseAccountId,
        description: line.description,
        amount: line.amount.toString(),
      })),
    );
    await guardPhysicalCash(
      tx,
      voucher.treasuryAccount,
      new Decimal(voucher.totalAmount.toString()),
    );
    await postDirectAccountJournal(tx, {
      sourceType: "EXPENSE_VOUCHER",
      sourceId: voucher.id,
      sourceNumber: voucher.number,
      accountingDate: voucher.expenseDate,
      description: `Expense voucher: ${voucher.number}.`,
      actorUserId,
      lines: [
        ...lines.map((line) => ({
          accountId: line.expenseAccountId,
          debit: line.amount.toFixed(),
          description: line.description,
        })),
        { accountId: voucher.treasuryAccount.glAccountId, credit: voucher.totalAmount.toString() },
      ],
    });
    await tx.expenseVoucher.update({
      where: { id: voucher.id },
      data: { status: "POSTED", postedByUserId: actorUserId, postedAt: new Date() },
    });
    await recordAuditEvent(tx, {
      actorUserId,
      action: "POST",
      entityType: "EXPENSE_VOUCHER",
      entityId: voucher.id,
      entityReference: voucher.number,
      module: "accounting",
      description: `Posted expense voucher ${voucher.number}.`,
      metadata: { totalAmount: voucher.totalAmount.toString(), lineCount: lines.length },
      beforeSnapshot: { status: voucher.status },
      afterSnapshot: { status: "POSTED" },
      controlEvent: true,
    });
  });
}

export async function cancelExpenseVoucher(id: string, actorUserId: string, reason: string) {
  return serializable(async (tx) => {
    const voucher = await tx.expenseVoucher.findUnique({ where: { id } });
    if (!voucher || voucher.status !== "DRAFT")
      throw new Phase23AccountingError("Only draft expenses can be cancelled.");
    await tx.expenseVoucher.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledByUserId: actorUserId,
        cancelledAt: new Date(),
        cancellationReason: requiredReason(reason, "Cancellation reason"),
      },
    });
    await recordAuditEvent(tx, {
      actorUserId,
      action: "CANCEL",
      entityType: "EXPENSE_VOUCHER",
      entityId: voucher.id,
      entityReference: voucher.number,
      module: "accounting",
      description: `Cancelled draft expense voucher ${voucher.number}.`,
      reasonCode: "OTHER",
      reason: requiredReason(reason, "Cancellation reason"),
      controlEvent: true,
    });
  });
}

export async function reverseExpenseVoucher(
  id: string,
  actorUserId: string,
  reversalDate: Date,
  reason: string,
) {
  return serializable(async (tx) => {
    const original = await tx.expenseVoucher.findUnique({
      where: { id },
      include: {
        treasuryAccount: { include: { glAccount: true } },
        lines: true,
        reversalVoucher: true,
      },
    });
    if (!original || original.status !== "POSTED")
      throw new Phase23AccountingError("Only posted expenses can be reversed.");
    if (original.reversalOfId || original.reversalVoucher)
      throw new Phase23AccountingError("This expense voucher already has a reversal.");
    const reversalReason = requiredReason(reason, "Reversal reason");
    await validateTreasury(tx, original.treasuryAccountId);
    const lines = await validateExpenseLines(
      tx,
      original.lines.map((line) => ({
        expenseAccountId: line.expenseAccountId,
        description: line.description,
        amount: line.amount.toString(),
      })),
    );
    const number = await nextNumber(tx.expenseVoucherSequence, reversalDate, "EXP");
    const reversal = await tx.expenseVoucher.create({
      data: {
        number,
        expenseDate: reversalDate,
        payee: original.payee,
        supplierId: original.supplierId,
        treasuryAccountId: original.treasuryAccountId,
        description: `Reversal of ${original.number}: ${original.description}`,
        totalAmount: original.totalAmount.toString(),
        referenceNumber: original.referenceNumber,
        notes: original.notes,
        status: "POSTED",
        reversalOfId: original.id,
        createdByUserId: actorUserId,
        postedByUserId: actorUserId,
        postedAt: new Date(),
        reversalReason,
        lines: { create: lines.map((line, index) => ({ ...line, position: index + 1 })) },
      },
    });
    await postDirectAccountJournal(tx, {
      sourceType: "EXPENSE_REVERSAL",
      sourceId: reversal.id,
      sourceNumber: reversal.number,
      accountingDate: reversalDate,
      description: `Expense reversal: ${original.number}. ${reversalReason}`,
      actorUserId,
      lines: [
        { accountId: original.treasuryAccount.glAccountId, debit: original.totalAmount.toString() },
        ...lines.map((line) => ({
          accountId: line.expenseAccountId,
          credit: line.amount.toFixed(),
          description: line.description,
        })),
      ],
    });
    await recordAuditEvent(tx, {
      actorUserId,
      action: "REVERSE",
      entityType: "EXPENSE_VOUCHER",
      entityId: reversal.id,
      entityReference: reversal.number,
      module: "accounting",
      description: `Reversed expense voucher ${original.number}.`,
      reasonCode: "ACCOUNTING_CORRECTION",
      reason: reversalReason,
      related: { entityType: "EXPENSE_VOUCHER", entityId: original.id, reference: original.number },
      controlEvent: true,
    });
    return reversal.id;
  });
}

export async function postTreasuryTransfer(id: string, actorUserId: string) {
  return serializable(async (tx) => {
    const transfer = await tx.treasuryTransfer.findUnique({
      where: { id },
      include: {
        sourceTreasuryAccount: { include: { glAccount: true } },
        destinationTreasuryAccount: { include: { glAccount: true } },
      },
    });
    if (!transfer || transfer.status !== "DRAFT")
      throw new Phase23AccountingError("Only draft transfers can be posted.");
    await validateTreasury(tx, transfer.sourceTreasuryAccountId);
    await validateTreasury(tx, transfer.destinationTreasuryAccountId);
    await guardPhysicalCash(
      tx,
      transfer.sourceTreasuryAccount,
      new Decimal(transfer.amount.toString()),
    );
    await postDirectAccountJournal(tx, {
      sourceType: "TREASURY_TRANSFER",
      sourceId: transfer.id,
      sourceNumber: transfer.number,
      accountingDate: transfer.transferDate,
      description: `Treasury transfer: ${transfer.number}.`,
      actorUserId,
      lines: [
        {
          accountId: transfer.destinationTreasuryAccount.glAccountId,
          debit: transfer.amount.toString(),
        },
        {
          accountId: transfer.sourceTreasuryAccount.glAccountId,
          credit: transfer.amount.toString(),
        },
      ],
    });
    await tx.treasuryTransfer.update({
      where: { id: transfer.id },
      data: { status: "POSTED", postedByUserId: actorUserId, postedAt: new Date() },
    });
    await recordAuditEvent(tx, {
      actorUserId,
      action: "POST",
      entityType: "TREASURY_TRANSFER",
      entityId: transfer.id,
      entityReference: transfer.number,
      module: "accounting",
      description: `Posted treasury transfer ${transfer.number}.`,
      metadata: {
        amount: transfer.amount.toString(),
        sourceTreasuryAccountId: transfer.sourceTreasuryAccountId,
        destinationTreasuryAccountId: transfer.destinationTreasuryAccountId,
      },
      beforeSnapshot: { status: transfer.status },
      afterSnapshot: { status: "POSTED" },
      controlEvent: true,
    });
  });
}

export async function cancelTreasuryTransfer(id: string, actorUserId: string, reason: string) {
  return serializable(async (tx) => {
    const transfer = await tx.treasuryTransfer.findUnique({ where: { id } });
    if (!transfer || transfer.status !== "DRAFT")
      throw new Phase23AccountingError("Only draft transfers can be cancelled.");
    await tx.treasuryTransfer.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledByUserId: actorUserId,
        cancelledAt: new Date(),
        cancellationReason: requiredReason(reason, "Cancellation reason"),
      },
    });
    await recordAuditEvent(tx, {
      actorUserId,
      action: "CANCEL",
      entityType: "TREASURY_TRANSFER",
      entityId: transfer.id,
      entityReference: transfer.number,
      module: "accounting",
      description: `Cancelled draft treasury transfer ${transfer.number}.`,
      reasonCode: "OTHER",
      reason: requiredReason(reason, "Cancellation reason"),
      controlEvent: true,
    });
  });
}

export async function reverseTreasuryTransfer(
  id: string,
  actorUserId: string,
  reversalDate: Date,
  reason: string,
) {
  return serializable(async (tx) => {
    const original = await tx.treasuryTransfer.findUnique({
      where: { id },
      include: {
        sourceTreasuryAccount: { include: { glAccount: true } },
        destinationTreasuryAccount: { include: { glAccount: true } },
        reversalTransfer: true,
      },
    });
    if (!original || original.status !== "POSTED")
      throw new Phase23AccountingError("Only posted treasury transfers can be reversed.");
    if (original.reversalOfId || original.reversalTransfer)
      throw new Phase23AccountingError("This treasury transfer already has a reversal.");
    const reversalReason = requiredReason(reason, "Reversal reason");
    await validateTreasury(tx, original.destinationTreasuryAccountId);
    await guardPhysicalCash(
      tx,
      original.destinationTreasuryAccount,
      new Decimal(original.amount.toString()),
    );
    const number = await nextNumber(tx.treasuryTransferSequence, reversalDate, "TRF");
    const reversal = await tx.treasuryTransfer.create({
      data: {
        number,
        transferDate: reversalDate,
        sourceTreasuryAccountId: original.destinationTreasuryAccountId,
        destinationTreasuryAccountId: original.sourceTreasuryAccountId,
        amount: original.amount,
        referenceNumber: original.referenceNumber,
        notes: `Reversal of ${original.number}.`,
        status: "POSTED",
        reversalOfId: original.id,
        reversalReason,
        createdByUserId: actorUserId,
        postedByUserId: actorUserId,
        postedAt: new Date(),
      },
    });
    await postDirectAccountJournal(tx, {
      sourceType: "TREASURY_TRANSFER",
      sourceId: reversal.id,
      sourceNumber: reversal.number,
      accountingDate: reversalDate,
      description: `Treasury-transfer reversal: ${original.number}. ${reversalReason}`,
      actorUserId,
      lines: [
        {
          accountId: original.sourceTreasuryAccount.glAccountId,
          debit: original.amount.toString(),
        },
        {
          accountId: original.destinationTreasuryAccount.glAccountId,
          credit: original.amount.toString(),
        },
      ],
    });
    await recordAuditEvent(tx, {
      actorUserId,
      action: "REVERSE",
      entityType: "TREASURY_TRANSFER",
      entityId: reversal.id,
      entityReference: reversal.number,
      module: "accounting",
      description: `Reversed treasury transfer ${original.number}.`,
      reasonCode: "ACCOUNTING_CORRECTION",
      reason: reversalReason,
      related: {
        entityType: "TREASURY_TRANSFER",
        entityId: original.id,
        reference: original.number,
      },
      controlEvent: true,
    });
    return reversal.id;
  });
}

export async function saveTreasuryTransfer(
  actorUserId: string,
  input: {
    sourceTreasuryAccountId: string;
    destinationTreasuryAccountId: string;
    transferDate: Date;
    amount: string;
    referenceNumber?: string | undefined;
    notes?: string | undefined;
  },
) {
  return serializable(async (tx) => {
    if (input.sourceTreasuryAccountId === input.destinationTreasuryAccountId)
      throw new Phase23AccountingError("Transfer source and destination must be different.");
    await validateTreasury(tx, input.sourceTreasuryAccountId);
    await validateTreasury(tx, input.destinationTreasuryAccountId);
    const amount = exactPositive(input.amount, "Transfer amount");
    const number = await nextNumber(tx.treasuryTransferSequence, input.transferDate, "TRF");
    return (
      await tx.treasuryTransfer.create({
        data: {
          number,
          sourceTreasuryAccountId: input.sourceTreasuryAccountId,
          destinationTreasuryAccountId: input.destinationTreasuryAccountId,
          transferDate: input.transferDate,
          amount: amount.toFixed(6),
          referenceNumber: input.referenceNumber ?? null,
          notes: input.notes ?? null,
          createdByUserId: actorUserId,
        },
      })
    ).id;
  });
}

export async function supplierPaymentPage() {
  const [payments, suppliers, treasuries] = await Promise.all([
    prisma.supplierPayment.findMany({
      include: {
        supplier: true,
        treasuryAccount: true,
        postedBy: true,
        allocations: true,
        reversalOf: true,
        reversalPayment: true,
      },
      orderBy: [{ paymentDate: "desc" }, { number: "desc" }],
      take: 100,
    }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: [{ name: "asc" }], take: 1000 }),
    treasuryAccounts(),
  ]);
  return {
    payments: payments.map((payment) => {
      const allocated = sum(payment.allocations.map((line) => line.allocatedAmount));
      return {
        ...payment,
        allocated: allocated.toFixed(6),
        unallocated: isEffectivePostedPayment(payment)
          ? new Decimal(payment.totalAmount.toString()).sub(allocated).toFixed(6)
          : "0",
      };
    }),
    suppliers,
    treasuries: treasuries.filter((account) => account.active),
  };
}

export async function expenseVoucherPage(query: {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: string;
}) {
  const pageSize = 50;
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const range = dateRange(query.from, query.to);
  const where: Prisma.ExpenseVoucherWhereInput = {
    ...(query.q
      ? {
          OR: [
            { number: { contains: query.q, mode: "insensitive" } },
            { payee: { contains: query.q, mode: "insensitive" } },
            { description: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(query.status ? { status: query.status as "DRAFT" | "POSTED" | "CANCELLED" } : {}),
    ...(range ? { expenseDate: range } : {}),
  };
  const [total, expenses] = await Promise.all([
    prisma.expenseVoucher.count({ where }),
    prisma.expenseVoucher.findMany({
      where,
      include: {
        treasuryAccount: true,
        postedBy: true,
        lines: { include: { expenseAccount: true } },
      },
      orderBy: [{ expenseDate: "desc" }, { number: "desc" }],
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
  ]);
  return { expenses, page, pageSize, total };
}

export async function supplierOpenItems(supplierId: string) {
  const entries = await prisma.supplierPayableLedgerEntry.findMany({
    where: {
      supplierId,
      signedAmount: { gt: 0 },
      sourceType: { not: "SUPPLIER_PAYMENT_REVERSAL" },
    },
    include: {
      allocations: { where: { supplierPayment: effectiveSupplierPaymentWhere() } },
      supplier: true,
    },
    orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
  });
  return entries
    .map((entry) => {
      const allocated = sum(entry.allocations.map((line) => line.allocatedAmount));
      return {
        ...entry,
        allocated: allocated.toFixed(6),
        outstanding: new Decimal(entry.signedAmount.toString()).sub(allocated).toFixed(6),
      };
    })
    .filter((entry) => new Decimal(entry.outstanding).gt(0));
}

export async function oldestFirstAllocationProposal(paymentId: string) {
  const payment = await prisma.supplierPayment.findUnique({
    where: { id: paymentId },
    include: { allocations: true, reversalPayment: true },
  });
  if (!payment || !isEffectivePostedPayment(payment)) return [];
  let remaining = new Decimal(payment.totalAmount.toString()).sub(
    sum(payment.allocations.map((line) => line.allocatedAmount)),
  );
  if (remaining.lte(0)) return [];
  const items = await supplierOpenItems(payment.supplierId);
  return items.flatMap((item) => {
    if (remaining.lte(0)) return [];
    const amount = Decimal.min(remaining, new Decimal(item.outstanding));
    remaining = remaining.sub(amount);
    return [{ payableLedgerEntryId: item.id, allocatedAmount: amount.toFixed(6) }];
  });
}

export async function supplierStatement(supplierId: string, dateFrom?: Date, dateTo?: Date) {
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return null;
  const [opening, entries, openItems] = await Promise.all([
    prisma.supplierPayableLedgerEntry.aggregate({
      where: { supplierId, ...(dateFrom ? { entryDate: { lt: dateFrom } } : {}) },
      _sum: { signedAmount: true },
    }),
    prisma.supplierPayableLedgerEntry.findMany({
      where: {
        supplierId,
        ...(dateFrom || dateTo
          ? {
              entryDate: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
    }),
    supplierOpenItems(supplierId),
  ]);
  let running = new Decimal(opening._sum.signedAmount?.toString() ?? "0");
  return {
    supplier,
    openingBalance: running.toFixed(6),
    rows: entries.map((entry) => {
      const amount = new Decimal(entry.signedAmount.toString());
      running = running.add(amount);
      return {
        ...entry,
        debit: amount.lt(0) ? amount.abs().toFixed(6) : "0",
        credit: amount.gt(0) ? amount.toFixed(6) : "0",
        runningBalance: running.toFixed(6),
      };
    }),
    closingBalance: running.toFixed(6),
    aging: aging(openItems),
  };
}

async function prepareAllocations(
  tx: Tx,
  supplierId: string,
  allocations: readonly AllocationInput[],
) {
  if (new Set(allocations.map((line) => line.payableLedgerEntryId)).size !== allocations.length)
    throw new Phase23AccountingError("A payable item can appear only once in an allocation.");
  const targets = await tx.supplierPayableLedgerEntry.findMany({
    where: {
      id: { in: allocations.map((line) => line.payableLedgerEntryId) },
      supplierId,
      signedAmount: { gt: 0 },
      sourceType: { not: "SUPPLIER_PAYMENT_REVERSAL" },
    },
    include: { allocations: { where: { supplierPayment: effectiveSupplierPaymentWhere() } } },
  });
  if (targets.length !== allocations.length)
    throw new Phase23AccountingError("Allocations must use open payable items for this supplier.");
  return allocations.map((line) => {
    const amount = exactPositive(line.allocatedAmount, "Allocation amount");
    const target = targets.find((entry) => entry.id === line.payableLedgerEntryId)!;
    const remaining = new Decimal(target.signedAmount.toString()).sub(
      sum(target.allocations.map((entry) => entry.allocatedAmount)),
    );
    if (amount.gt(remaining))
      throw new Phase23AccountingError(
        `Allocation exceeds remaining value on ${target.sourceNumber ?? target.sourceId}.`,
      );
    return { payableLedgerEntryId: target.id, allocatedAmount: amount.toFixed(6) };
  });
}
function allocationCreate(actorUserId: string) {
  return (allocation: { payableLedgerEntryId: string; allocatedAmount: string }) => ({
    ...allocation,
    createdByUserId: actorUserId,
  });
}
async function validateExpenseLines(tx: Tx, input: readonly ExpenseLineInput[]) {
  if (!input.length)
    throw new Phase23AccountingError("An expense voucher needs at least one line.");
  const accountIds = [...new Set(input.map((line) => line.expenseAccountId))];
  const accounts = await tx.accountingAccount.findMany({ where: { id: { in: accountIds } } });
  if (
    accounts.length !== accountIds.length ||
    accounts.some(
      (account) =>
        !account.active ||
        !account.postingAllowed ||
        account.isControl ||
        account.accountType !== "EXPENSE",
    )
  )
    throw new Phase23AccountingError("Expense lines require active, non-control EXPENSE accounts.");
  return input.map((line) => ({
    expenseAccountId: line.expenseAccountId,
    description: line.description,
    amount: exactPositive(line.amount, "Expense amount"),
  }));
}
async function validateTreasury(tx: Tx, treasuryAccountId: string) {
  const treasury = await tx.treasuryAccount.findUnique({
    where: { id: treasuryAccountId },
    include: { glAccount: true },
  });
  if (
    !treasury ||
    !treasury.active ||
    !treasury.glAccount.active ||
    !treasury.glAccount.postingAllowed ||
    treasury.glAccount.accountType !== "ASSET"
  )
    throw new Phase23AccountingError(
      "Treasury account or linked GL account is unavailable for posting.",
    );
  return treasury;
}
async function guardPhysicalCash(
  tx: Tx,
  treasury: { accountType: string; glAccountId: string },
  amount: Decimal,
) {
  if (!["CASH", "PETTY_CASH"].includes(treasury.accountType)) return;
  const balance = await glBalance(tx, treasury.glAccountId);
  if (balance.sub(amount).isNegative())
    throw new Phase23AccountingError("Cash or petty-cash balance cannot become negative.");
}
async function mappedAccount(tx: Tx, mappingKey: "ACCOUNTS_PAYABLE") {
  const mapping = await tx.accountingAccountMapping.findUnique({
    where: { accountingSettingsId_mappingKey: { accountingSettingsId: "default", mappingKey } },
    include: { account: true },
  });
  if (!mapping?.account.active || !mapping.account.postingAllowed)
    throw new AccountingPostingError("Accounts Payable mapping is unavailable.");
  return mapping.accountId;
}
async function glBalance(client: Tx | typeof prisma, accountId: string) {
  const result = await client.accountingJournalLine.aggregate({
    where: { accountId, journal: { status: "POSTED" } },
    _sum: { debit: true, credit: true },
  });
  return new Decimal(result._sum.debit?.toString() ?? "0").sub(
    result._sum.credit?.toString() ?? "0",
  );
}
async function treasurySummary(
  client: typeof prisma,
  treasury: Prisma.TreasuryAccountGetPayload<{ include: { glAccount: true } }>,
) {
  const [balance, recentActivity] = await Promise.all([
    glBalance(client, treasury.glAccountId),
    client.accountingJournalLine.findMany({
      where: { accountId: treasury.glAccountId, journal: { status: "POSTED" } },
      include: { journal: true },
      orderBy: [{ journal: { accountingDate: "desc" } }, { position: "desc" }],
      take: 5,
    }),
  ]);
  return {
    ...treasury,
    balance: balance.toFixed(6),
    recentActivity: recentActivity.map((line) => ({
      journalNumber: line.journal.journalNumber,
      date: line.journal.accountingDate,
      amount: new Decimal(line.debit.toString()).sub(line.credit.toString()).toFixed(6),
    })),
  };
}
async function nextNumber(
  sequence: {
    upsert(args: {
      where: { year: number };
      create: { year: number; nextValue: number };
      update: { nextValue: { increment: number } };
    }): Promise<{ nextValue: number }>;
  },
  date: Date,
  prefix: string,
) {
  const year = date.getUTCFullYear();
  const row = await sequence.upsert({
    where: { year },
    create: { year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return `${prefix}-${year}-${String(row.nextValue - 1).padStart(6, "0")}`;
}
function exactPositive(value: string, label: string) {
  const amount = new Decimal(value);
  if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 6)
    throw new Phase23AccountingError(`${label} must be a positive amount with up to six decimals.`);
  return amount;
}
function requiredReason(value: string, label: string) {
  const reason = value.trim();
  if (!reason) throw new Phase23AccountingError(`${label} is required.`);
  return reason;
}
function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  const start = validDate(from);
  const end = validDate(to, true);
  return start || end
    ? { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) }
    : undefined;
}
function validDate(value?: string, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
}
function aging(items: readonly { entryDate: Date; outstanding: string }[]) {
  const asOf = new Date();
  const buckets = {
    current: new Decimal(0),
    days31To60: new Decimal(0),
    days61To90: new Decimal(0),
    over90: new Decimal(0),
  };
  for (const item of items) {
    const days = Math.max(0, Math.floor((asOf.getTime() - item.entryDate.getTime()) / 86_400_000));
    const amount = new Decimal(item.outstanding);
    if (days <= 30) buckets.current = buckets.current.add(amount);
    else if (days <= 60) buckets.days31To60 = buckets.days31To60.add(amount);
    else if (days <= 90) buckets.days61To90 = buckets.days61To90.add(amount);
    else buckets.over90 = buckets.over90.add(amount);
  }
  return Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, value.toFixed(6)]));
}
function sum(values: readonly { toString(): string }[]): Decimal {
  return values.reduce<Decimal>((total, value) => total.add(value.toString()), new Decimal(0));
}
async function serializable<T>(operation: (tx: Tx) => Promise<T>) {
  return prisma.$transaction(operation, { isolationLevel: "Serializable" });
}
