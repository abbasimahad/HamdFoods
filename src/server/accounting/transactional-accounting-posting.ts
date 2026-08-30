import "server-only";

import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import {
  type AccountingMappingKey,
  type AccountingSourceType,
  type Prisma,
} from "@/generated/prisma/client";
import { recordAuditEvent } from "@/server/audit/audit-event";

type Client = Prisma.TransactionClient;

export type AccountingLineInput = {
  mapping: AccountingMappingKey;
  debit?: string;
  credit?: string;
  description?: string;
  customerId?: string;
  supplierId?: string;
  itemId?: string;
  productionBatchId?: string;
  sourceMetadata?: Prisma.InputJsonValue;
};

type AutomaticJournalInput = {
  sourceType: AccountingSourceType;
  sourceId: string;
  sourceNumber?: string | null;
  accountingDate: Date;
  description: string;
  actorUserId: string;
  lines: readonly AccountingLineInput[];
  allowHistoricalBackfill?: boolean;
};

export class AccountingPostingError extends Error {}

export type ManualJournalLineInput = {
  accountId: string;
  debit?: string;
  credit?: string;
  description?: string;
};

export type DirectAccountJournalLineInput = {
  accountId: string;
  debit?: string;
  credit?: string;
  description?: string;
  supplierId?: string;
};

export async function postDirectAccountJournal(
  tx: Client,
  input: {
    sourceType: AccountingSourceType;
    sourceId: string;
    sourceNumber?: string | null;
    accountingDate: Date;
    description: string;
    actorUserId: string;
    lines: readonly DirectAccountJournalLineInput[];
  },
) {
  const existing = await tx.accountingJournal.findUnique({
    where: { sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const period = await tx.accountingPeriod.findFirst({
    where: {
      status: "OPEN",
      startDate: { lte: input.accountingDate },
      endDate: { gte: input.accountingDate },
    },
  });
  if (!period)
    throw new AccountingPostingError("No OPEN accounting period contains the journal date.");
  const accountIds = [...new Set(input.lines.map((line) => line.accountId))];
  const accounts = await tx.accountingAccount.findMany({ where: { id: { in: accountIds } } });
  if (accounts.length !== accountIds.length)
    throw new AccountingPostingError("A journal account no longer exists.");
  if (accounts.some((account) => !account.active || !account.postingAllowed))
    throw new AccountingPostingError("A journal account is inactive or does not allow posting.");
  const lines = input.lines.map((line, index) => ({
    ...line,
    position: index + 1,
    debit: amount(line.debit),
    credit: amount(line.credit),
  }));
  validateLines(lines);
  const totalDebit = sum(lines.map((line) => line.debit));
  const totalCredit = sum(lines.map((line) => line.credit));
  const journal = await tx.accountingJournal.create({
    data: {
      journalNumber: await nextJournalNumber(tx, input.accountingDate.getUTCFullYear()),
      accountingDate: input.accountingDate,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceNumber: input.sourceNumber ?? null,
      description: input.description,
      status: "POSTED",
      totalDebit: totalDebit.toFixed(6),
      totalCredit: totalCredit.toFixed(6),
      postedByUserId: input.actorUserId,
      postedAt: new Date(),
      lines: {
        create: lines.map((line) => ({
          position: line.position,
          accountId: line.accountId,
          description: line.description ?? null,
          debit: line.debit.toFixed(6),
          credit: line.credit.toFixed(6),
          supplierId: line.supplierId ?? null,
        })),
      },
    },
  });
  await recordAuditEvent(tx, {
    actorUserId: input.actorUserId,
    action: "POST",
    entityType: "JOURNAL",
    entityId: journal.id,
    entityReference: journal.journalNumber,
    module: "accounting",
    description: `Posted source-linked journal for ${input.sourceNumber ?? input.sourceType}.`,
    afterSnapshot: {
      accountingDate: input.accountingDate.toISOString().slice(0, 10),
      totalDebit: totalDebit.toFixed(6),
      totalCredit: totalCredit.toFixed(6),
    },
  });
  return journal.id;
}

/**
 * The only journal writer for automatic events. It locks source identity through
 * the database unique constraint, validates every exact decimal line, and leaves
 * an attributable block instead of inventing an accounting result.
 */
export async function postAutomaticJournal(
  tx: Client,
  input: AutomaticJournalInput,
): Promise<{ journalId: string | null; blocked: boolean }> {
  const existing = await tx.accountingJournal.findUnique({
    where: { sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId } },
    select: { id: true },
  });
  if (existing) return { journalId: existing.id, blocked: false };

  const sourceKey = `${input.sourceType}:${input.sourceId}`;
  const [settings, period] = await Promise.all([
    tx.accountingSettings.findUnique({
      where: { id: "default" },
      include: { mappings: { include: { account: true } } },
    }),
    tx.accountingPeriod.findFirst({
      where: {
        status: "OPEN",
        startDate: { lte: input.accountingDate },
        endDate: { gte: input.accountingDate },
      },
    }),
  ]);
  if (!settings)
    return block(
      tx,
      input,
      sourceKey,
      "MISSING_ACCOUNTING_SETTINGS",
      "Accounting settings are not configured.",
    );
  if (!input.allowHistoricalBackfill && !period)
    return block(
      tx,
      input,
      sourceKey,
      "CLOSED_ACCOUNTING_PERIOD",
      "No OPEN accounting period contains the accounting date.",
    );

  const mappings = new Map(settings.mappings.map((entry) => [entry.mappingKey, entry.account]));
  const unavailableMapping = input.lines.find((line) => {
    const account = mappings.get(line.mapping);
    return !account || !account.active || !account.postingAllowed;
  })?.mapping;
  if (unavailableMapping)
    return block(
      tx,
      input,
      sourceKey,
      "MISSING_OR_UNUSABLE_ACCOUNT_MAPPING",
      `Accounting mapping ${unavailableMapping} is missing or unusable.`,
    );
  const lines = input.lines.map((line, index) => {
    const account = mappings.get(line.mapping)!;
    return {
      ...line,
      accountId: account.id,
      position: index + 1,
      debit: amount(line.debit),
      credit: amount(line.credit),
    };
  });
  validateLines(lines);
  const totalDebit = sum(lines.map((line) => line.debit));
  const totalCredit = sum(lines.map((line) => line.credit));
  const journalNumber = await nextJournalNumber(tx, input.accountingDate.getUTCFullYear());
  const journal = await tx.accountingJournal.create({
    data: {
      journalNumber,
      accountingDate: input.accountingDate,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceNumber: input.sourceNumber ?? null,
      description: input.description,
      status: "POSTED",
      totalDebit: totalDebit.toFixed(6),
      totalCredit: totalCredit.toFixed(6),
      postedByUserId: input.actorUserId,
      postedAt: new Date(),
      lines: {
        create: lines.map((line) => ({
          position: line.position,
          account: { connect: { id: line.accountId } },
          description: line.description ?? null,
          debit: line.debit.toFixed(6),
          credit: line.credit.toFixed(6),
          customerId: line.customerId ?? null,
          supplierId: line.supplierId ?? null,
          itemId: line.itemId ?? null,
          productionBatchId: line.productionBatchId ?? null,
          ...(line.sourceMetadata === undefined ? {} : { sourceMetadata: line.sourceMetadata }),
        })),
      },
    },
  });
  await tx.accountingPostingBlock.updateMany({
    where: { sourceKey, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  await recordAuditEvent(tx, {
    actorUserId: input.actorUserId,
    action: "POST",
    entityType: "JOURNAL",
    entityId: journal.id,
    entityReference: journal.journalNumber,
    module: "accounting",
    description: `Posted source-linked journal for ${input.sourceNumber ?? input.sourceType}.`,
    afterSnapshot: {
      accountingDate: input.accountingDate.toISOString().slice(0, 10),
      totalDebit: totalDebit.toFixed(6),
      totalCredit: totalCredit.toFixed(6),
    },
    related: {
      entityType: accountingSourceAuditEntityType(input.sourceType),
      entityId: input.sourceId,
      reference: input.sourceNumber ?? null,
    },
    controlEvent: true,
  });
  return { journalId: journal.id, blocked: false };
}

export async function postValuationAccounting(
  tx: Client,
  valuationEntryId: string,
  actorUserId: string,
  allowHistoricalBackfill = false,
) {
  const entry = await tx.inventoryValuationEntry.findUnique({
    where: { id: valuationEntryId },
    include: { item: true },
  });
  if (!entry || entry.state !== "FINAL" || !entry.valueDelta) return;
  const value = new Decimal(entry.valueDelta.toString());
  if (value.isZero()) return;
  const inventory = inventoryMapping(entry.item.itemType);
  const common = {
    sourceId: entry.id,
    sourceNumber: entry.sourceNumber,
    accountingDate: entry.effectiveAt,
    actorUserId,
    allowHistoricalBackfill,
  };
  if (entry.entryType === "PURCHASE_RECEIPT")
    return postAutomaticJournal(tx, {
      ...common,
      sourceType: "GOODS_RECEIPT",
      description: `Inventory acquisition from ${entry.sourceNumber ?? "goods receipt"}.`,
      lines: [
        { mapping: inventory, debit: value.toFixed(), itemId: entry.itemId },
        { mapping: "GRNI", credit: value.toFixed(), itemId: entry.itemId },
      ],
    });
  if (entry.entryType === "SUPPLIER_REPLACEMENT")
    return postAutomaticJournal(tx, {
      ...common,
      sourceType: "GOODS_RECEIPT",
      sourceId: `replacement:${entry.id}`,
      description: `Replacement inventory receipt from ${entry.sourceNumber ?? "goods receipt"}.`,
      lines: [
        { mapping: inventory, debit: value.abs().toFixed(), itemId: entry.itemId },
        { mapping: "SUPPLIER_CLAIMS", credit: value.abs().toFixed(), itemId: entry.itemId },
      ],
    });
  if (entry.entryType === "LANDED_COST")
    return postAutomaticJournal(tx, {
      ...common,
      sourceType: "LANDED_COST",
      sourceId: entry.sourceKey,
      description: `Landed cost capitalization: ${entry.sourceNumber ?? entry.sourceKey}.`,
      lines: [
        { mapping: inventory, debit: value.abs().toFixed(), itemId: entry.itemId },
        { mapping: "LANDED_COST_CLEARING", credit: value.abs().toFixed(), itemId: entry.itemId },
      ],
    });
  if (["VALUATION_INITIALIZATION", "COST_ADJUSTMENT"].includes(entry.entryType)) {
    const increase = value.gt(0);
    return postAutomaticJournal(tx, {
      ...common,
      sourceType:
        entry.entryType === "VALUATION_INITIALIZATION"
          ? "OPENING_INVENTORY"
          : "VALUATION_ADJUSTMENT",
      description: `Inventory valuation adjustment: ${entry.sourceNumber ?? entry.sourceKey}.`,
      lines: increase
        ? [
            { mapping: inventory, debit: value.toFixed(), itemId: entry.itemId },
            {
              mapping:
                entry.entryType === "VALUATION_INITIALIZATION"
                  ? "OPENING_BALANCE_EQUITY"
                  : "INVENTORY_VARIANCE",
              credit: value.toFixed(),
              itemId: entry.itemId,
            },
          ]
        : [
            {
              mapping:
                entry.entryType === "VALUATION_INITIALIZATION"
                  ? "OPENING_BALANCE_EQUITY"
                  : "INVENTORY_VARIANCE",
              debit: value.abs().toFixed(),
              itemId: entry.itemId,
            },
            { mapping: inventory, credit: value.abs().toFixed(), itemId: entry.itemId },
          ],
    });
  }
  if (["PRODUCTION_CONSUMPTION", "PACKAGING_CONSUMPTION"].includes(entry.entryType))
    return postAutomaticJournal(tx, {
      ...common,
      sourceType:
        entry.entryType === "PRODUCTION_CONSUMPTION"
          ? "PRODUCTION_CONSUMPTION"
          : "PACKAGING_CONSUMPTION",
      description: `Production consumption: ${entry.sourceNumber ?? entry.sourceKey}.`,
      lines: [
        {
          mapping: "WORK_IN_PROCESS",
          debit: value.abs().toFixed(),
          ...(entry.productionBatchId ? { productionBatchId: entry.productionBatchId } : {}),
          itemId: entry.itemId,
        },
        {
          mapping: inventory,
          credit: value.abs().toFixed(),
          ...(entry.productionBatchId ? { productionBatchId: entry.productionBatchId } : {}),
          itemId: entry.itemId,
        },
      ],
    });
}

export async function postSalesInvoiceAccounting(
  tx: Client,
  invoiceId: string,
  actorUserId: string,
  allowHistoricalBackfill = false,
) {
  const invoice = await tx.salesInvoice.findUnique({
    where: { id: invoiceId },
    include: { lines: true },
  });
  if (!invoice || invoice.status !== "POSTED") return;
  await postAutomaticJournal(tx, {
    sourceType: "SALES_INVOICE_REVENUE",
    sourceId: invoice.id,
    sourceNumber: invoice.number,
    accountingDate: invoice.invoiceDate,
    description: `Sales invoice revenue: ${invoice.number}.`,
    actorUserId,
    allowHistoricalBackfill,
    lines: [
      {
        mapping: "ACCOUNTS_RECEIVABLE",
        debit: invoice.grandTotal.toString(),
        customerId: invoice.customerId,
      },
      ...(new Decimal(invoice.discountTotal.toString()).gt(0)
        ? [
            {
              mapping: "SALES_DISCOUNTS" as const,
              debit: invoice.discountTotal.toString(),
              customerId: invoice.customerId,
            },
          ]
        : []),
      {
        mapping: "SALES_REVENUE",
        credit: invoice.subtotal.toString(),
        customerId: invoice.customerId,
      },
      ...(new Decimal(invoice.taxTotal.toString()).gt(0)
        ? [
            {
              mapping: "OUTPUT_TAX" as const,
              credit: invoice.taxTotal.toString(),
              customerId: invoice.customerId,
            },
          ]
        : []),
    ],
  });
  const valuation = await tx.inventoryValuationEntry.aggregate({
    where: {
      sourceType: "SALES_INVOICE",
      sourceId: invoice.id,
      entryType: "SALES_OUT",
      state: "FINAL",
    },
    _sum: { valueDelta: true },
  });
  const cost = new Decimal(valuation._sum.valueDelta?.toString() ?? "0").abs();
  if (cost.gt(0))
    await postAutomaticJournal(tx, {
      sourceType: "SALES_INVOICE_COGS",
      sourceId: invoice.id,
      sourceNumber: invoice.number,
      accountingDate: invoice.invoiceDate,
      description: `Sales invoice cost of goods sold: ${invoice.number}.`,
      actorUserId,
      allowHistoricalBackfill,
      lines: [
        { mapping: "COST_OF_GOODS_SOLD", debit: cost.toFixed(), customerId: invoice.customerId },
        { mapping: "FINISHED_GOODS_INVENTORY", credit: cost.toFixed() },
      ],
    });
}

export async function postCustomerPaymentAccounting(
  tx: Client,
  paymentId: string,
  actorUserId: string,
  allowHistoricalBackfill = false,
) {
  const payment = await tx.customerPayment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status !== "POSTED") return;
  const cashMapping = payment.method === "CASH" ? "DEFAULT_CASH" : "DEFAULT_BANK";
  return postAutomaticJournal(tx, {
    sourceType: "CUSTOMER_PAYMENT",
    sourceId: payment.id,
    sourceNumber: payment.number,
    accountingDate: payment.paymentDate,
    description: `Customer payment: ${payment.number}.`,
    actorUserId,
    allowHistoricalBackfill,
    lines: [
      {
        mapping: cashMapping,
        debit: payment.totalAmount.toString(),
        customerId: payment.customerId,
      },
      {
        mapping: "ACCOUNTS_RECEIVABLE",
        credit: payment.totalAmount.toString(),
        customerId: payment.customerId,
      },
    ],
  });
}

export async function postGoodsReceiptAcceptanceAccounting(
  tx: Client,
  receiptId: string,
  actorUserId: string,
  allowHistoricalBackfill = false,
) {
  const receipt = await tx.goodsReceipt.findUnique({
    where: { id: receiptId },
    include: { lines: { include: { qcDecision: true, purchaseOrderLine: true } } },
  });
  if (!receipt || receipt.status !== "QC_COMPLETED" || receipt.purpose !== "PURCHASE") return;
  const valuations = await tx.inventoryValuationEntry.findMany({
    where: {
      sourceType: "GOODS_RECEIPT",
      sourceId: receipt.id,
      entryType: "PURCHASE_RECEIPT",
      state: "FINAL",
    },
    select: { sourceKey: true, valueDelta: true },
  });
  const valuationByReceiptLine = new Map(
    valuations.map((entry) => [entry.sourceKey.replace("GRN-COST:", ""), entry]),
  );
  const acceptedDetails = receipt.lines.map((line) => {
    const acceptedQuantity = new Decimal(line.qcDecision?.acceptedQuantity.toString() ?? "0");
    const valuation = valuationByReceiptLine.get(line.id);
    if (!valuation && acceptedQuantity.gt(0))
      throw new AccountingPostingError(
        `Goods receipt valuation is missing for line ${line.position}.`,
      );
    const ratio = acceptedQuantity.div(line.normalizedQuantity);
    const base = new Decimal(valuation?.valueDelta?.toString() ?? "0").mul(ratio);
    const purchaseBase = new Decimal(line.purchaseOrderLine.netAmount.toString()).sub(
      line.purchaseOrderLine.taxAmount.toString(),
    );
    const tax = purchaseBase.isZero()
      ? new Decimal(0)
      : base.mul(line.purchaseOrderLine.taxAmount.toString()).div(purchaseBase);
    return { base, tax };
  });
  const accepted = sum(acceptedDetails.map((line) => line.base));
  const tax = sum(acceptedDetails.map((line) => line.tax));
  if (accepted.lte(0)) return;
  const settings = await tx.accountingSettings.findUnique({ where: { id: "default" } });
  if (!settings || (tax.gt(0) && settings.purchaseTaxTreatment === "NOT_CONFIGURED"))
    return void (await block(
      tx,
      {
        sourceType: "GOODS_RECEIPT_ACCEPTANCE",
        sourceId: receipt.id,
        accountingDate: receipt.receiptDate,
        description: "",
        actorUserId,
        lines: [],
      },
      `GOODS_RECEIPT_ACCEPTANCE:${receipt.id}`,
      "PURCHASE_TAX_NOT_CONFIGURED",
      "Purchase tax treatment must be configured before payable recognition.",
    ));
  if (tax.gt(0) && settings.purchaseTaxTreatment === "CAPITALIZE")
    return void (await block(
      tx,
      {
        sourceType: "GOODS_RECEIPT_ACCEPTANCE",
        sourceId: receipt.id,
        accountingDate: receipt.receiptDate,
        description: "",
        actorUserId,
        lines: [],
      },
      `GOODS_RECEIPT_ACCEPTANCE:${receipt.id}`,
      "PURCHASE_TAX_POLICY_REQUIRES_VALUATION_SUPPORT",
      "Purchase-tax capitalization is blocked because Phase 21 valuation excludes tax from inventory cost.",
    ));
  const payable = accepted.add(tax);
  const result = await postAutomaticJournal(tx, {
    sourceType: "GOODS_RECEIPT_ACCEPTANCE",
    sourceId: receipt.id,
    sourceNumber: receipt.number,
    accountingDate: receipt.qcCompletedAt ?? receipt.receiptDate,
    description: `Supplier payable recognition: ${receipt.number}.`,
    actorUserId,
    allowHistoricalBackfill,
    lines: [
      { mapping: "GRNI", debit: accepted.toFixed(), supplierId: receipt.supplierId },
      ...(settings.purchaseTaxTreatment === "RECOVERABLE" && tax.gt(0)
        ? [{ mapping: "INPUT_TAX" as const, debit: tax.toFixed(), supplierId: receipt.supplierId }]
        : settings.purchaseTaxTreatment === "EXPENSE" && tax.gt(0)
          ? [{ mapping: "PURCHASE_TAX_EXPENSE" as const, debit: tax.toFixed() }]
          : []),
      { mapping: "ACCOUNTS_PAYABLE", credit: payable.toFixed(), supplierId: receipt.supplierId },
    ],
  });
  if (result.journalId)
    await tx.supplierPayableLedgerEntry.upsert({
      where: { sourceKey: `PURCHASE_ACCEPTANCE:${receipt.id}` },
      create: {
        sourceKey: `PURCHASE_ACCEPTANCE:${receipt.id}`,
        supplierId: receipt.supplierId,
        entryType: "PURCHASE_ACCEPTANCE",
        entryDate: receipt.qcCompletedAt ?? receipt.receiptDate,
        signedAmount: payable.toFixed(),
        sourceType: "GOODS_RECEIPT",
        sourceId: receipt.id,
        sourceNumber: receipt.number,
        description: `Supplier payable for ${receipt.number}.`,
        journalId: result.journalId,
      },
      update: {},
    });
}

export async function postSalesReturnAccounting(
  tx: Client,
  returnId: string,
  actorUserId: string,
  allowHistoricalBackfill = false,
) {
  const salesReturn = await tx.salesReturn.findUnique({
    where: { id: returnId },
    include: { lines: true },
  });
  if (!salesReturn || salesReturn.status !== "COMPLETED" || salesReturn.type !== "INVOICED_RETURN")
    return;
  const net = sum(
    salesReturn.lines.map((line) =>
      new Decimal(line.netAmount?.toString() ?? "0").sub(line.taxAmount?.toString() ?? "0"),
    ),
  );
  const tax = sum(salesReturn.lines.map((line) => new Decimal(line.taxAmount?.toString() ?? "0")));
  const credit = net.add(tax);
  if (credit.gt(0))
    await postAutomaticJournal(tx, {
      sourceType: "SALES_RETURN_CREDIT",
      sourceId: salesReturn.id,
      sourceNumber: salesReturn.number,
      accountingDate: salesReturn.completedAt ?? salesReturn.returnAt,
      description: `Sales return credit: ${salesReturn.number}.`,
      actorUserId,
      allowHistoricalBackfill,
      lines: [
        { mapping: "SALES_RETURNS", debit: net.toFixed(), customerId: salesReturn.customerId },
        ...(tax.gt(0)
          ? [
              {
                mapping: "OUTPUT_TAX" as const,
                debit: tax.toFixed(),
                customerId: salesReturn.customerId,
              },
            ]
          : []),
        {
          mapping: "ACCOUNTS_RECEIVABLE",
          credit: credit.toFixed(),
          customerId: salesReturn.customerId,
        },
      ],
    });
  const valuation = await tx.inventoryValuationEntry.aggregate({
    where: {
      sourceType: "SALES_RETURN",
      sourceId: salesReturn.id,
      entryType: "SALES_RETURN",
      state: "FINAL",
    },
    _sum: { valueDelta: true },
  });
  const cost = new Decimal(valuation._sum.valueDelta?.toString() ?? "0");
  if (cost.gt(0))
    await postAutomaticJournal(tx, {
      sourceType: "SALES_RETURN_RECEIPT",
      sourceId: salesReturn.id,
      sourceNumber: salesReturn.number,
      accountingDate: salesReturn.receivedAt ?? salesReturn.returnAt,
      description: `Sales return inventory restoration: ${salesReturn.number}.`,
      actorUserId,
      allowHistoricalBackfill,
      lines: [
        { mapping: "FINISHED_GOODS_INVENTORY", debit: cost.toFixed() },
        { mapping: "COST_OF_GOODS_SOLD", credit: cost.toFixed() },
      ],
    });
}

export async function postPurchaseReturnAccounting(
  tx: Client,
  purchaseReturnId: string,
  actorUserId: string,
  allowHistoricalBackfill = false,
) {
  const purchaseReturn = await tx.purchaseReturn.findUnique({
    where: { id: purchaseReturnId },
    include: {
      lines: {
        include: { originalGoodsReceiptLine: { include: { purchaseOrderLine: true } } },
      },
    },
  });
  if (
    !purchaseReturn ||
    !["POSTED", "AWAITING_REPLACEMENT", "COMPLETED"].includes(purchaseReturn.status)
  )
    return;
  const valuations = await tx.inventoryValuationEntry.findMany({
    where: {
      sourceType: "PURCHASE_RETURN",
      sourceId: purchaseReturn.id,
      entryType: "PURCHASE_RETURN",
      state: "FINAL",
    },
    include: { item: true },
  });
  const carryingValue = sum(
    valuations.map((entry) => new Decimal(entry.valueDelta?.toString() ?? "0").abs()),
  );
  if (carryingValue.isZero()) return;
  const originalReceiptValuations = await tx.inventoryValuationEntry.findMany({
    where: {
      sourceKey: {
        in: purchaseReturn.lines.map((line) => `GRN-COST:${line.originalGoodsReceiptLineId}`),
      },
      entryType: "PURCHASE_RECEIPT",
      state: "FINAL",
    },
    select: { sourceKey: true, valueDelta: true },
  });
  const receiptBasis = new Map(
    originalReceiptValuations.map((entry) => [entry.sourceKey.replace("GRN-COST:", ""), entry]),
  );
  const commercial = purchaseReturn.lines.reduce((total, line) => {
    const originalValue = receiptBasis.get(line.originalGoodsReceiptLineId);
    if (!originalValue)
      throw new AccountingPostingError(
        `Original goods receipt valuation is missing for purchase-return line ${line.position}.`,
      );
    return total.add(
      new Decimal(originalValue.valueDelta?.toString() ?? "0")
        .abs()
        .mul(line.normalizedQuantity)
        .div(line.originalGoodsReceiptLine.normalizedQuantity),
    );
  }, new Decimal(0));
  const tax = purchaseReturn.lines.reduce((total, line) => {
    const purchaseBase = new Decimal(
      line.originalGoodsReceiptLine.purchaseOrderLine.netAmount.toString(),
    ).sub(line.originalGoodsReceiptLine.purchaseOrderLine.taxAmount.toString());
    if (purchaseBase.isZero()) return total;
    const originalValue = receiptBasis.get(line.originalGoodsReceiptLineId)!;
    const returnedBase = new Decimal(originalValue.valueDelta?.toString() ?? "0")
      .abs()
      .mul(line.normalizedQuantity)
      .div(line.originalGoodsReceiptLine.normalizedQuantity);
    return total.add(
      returnedBase
        .mul(line.originalGoodsReceiptLine.purchaseOrderLine.taxAmount.toString())
        .div(purchaseBase),
    );
  }, new Decimal(0));
  const awaitingReplacement = purchaseReturn.replacementExpected;
  const allRejectedBeforePayable = purchaseReturn.lines.every(
    (line) => line.source === "QC_REJECTED",
  );
  const settings = await tx.accountingSettings.findUnique({ where: { id: "default" } });
  if (!awaitingReplacement && !allRejectedBeforePayable && !settings)
    throw new AccountingPostingError("Accounting settings are not configured.");
  if (
    !awaitingReplacement &&
    !allRejectedBeforePayable &&
    tax.gt(0) &&
    settings?.purchaseTaxTreatment === "CAPITALIZE"
  )
    return block(
      tx,
      {
        sourceType: "PURCHASE_RETURN",
        sourceId: purchaseReturn.id,
        accountingDate: purchaseReturn.postedAt ?? purchaseReturn.returnDate,
        description: "",
        actorUserId,
        lines: [],
      },
      `PURCHASE_RETURN:${purchaseReturn.id}`,
      "PURCHASE_TAX_POLICY_REQUIRES_VALUATION_SUPPORT",
      "Purchase-tax capitalization is blocked because Phase 21 valuation excludes tax from inventory cost.",
    );
  const payableCredit = commercial.add(tax);
  const variance = commercial.sub(carryingValue);
  const debitLines: AccountingLineInput[] = awaitingReplacement
    ? [
        {
          mapping: "SUPPLIER_CLAIMS",
          debit: carryingValue.toFixed(),
          supplierId: purchaseReturn.supplierId,
        },
      ]
    : allRejectedBeforePayable
      ? [{ mapping: "GRNI", debit: carryingValue.toFixed(), supplierId: purchaseReturn.supplierId }]
      : [
          {
            mapping: "ACCOUNTS_PAYABLE",
            debit: payableCredit.toFixed(),
            supplierId: purchaseReturn.supplierId,
          },
          ...(variance.lt(0)
            ? [{ mapping: "PURCHASE_RETURN_VARIANCE" as const, debit: variance.abs().toFixed() }]
            : []),
        ];
  const creditLines: AccountingLineInput[] = [
    ...valuations.map((entry) => ({
      mapping: inventoryMapping(entry.item.itemType),
      credit: new Decimal(entry.valueDelta?.toString() ?? "0").abs().toFixed(),
      itemId: entry.itemId,
    })),
    ...(!awaitingReplacement && !allRejectedBeforePayable && tax.gt(0)
      ? [
          settings?.purchaseTaxTreatment === "EXPENSE"
            ? { mapping: "PURCHASE_TAX_EXPENSE" as const, credit: tax.toFixed() }
            : {
                mapping: "INPUT_TAX" as const,
                credit: tax.toFixed(),
                supplierId: purchaseReturn.supplierId,
              },
        ]
      : []),
    ...(!awaitingReplacement && !allRejectedBeforePayable && variance.gt(0)
      ? [{ mapping: "PURCHASE_RETURN_VARIANCE" as const, credit: variance.toFixed() }]
      : []),
  ];
  const result = await postAutomaticJournal(tx, {
    sourceType: "PURCHASE_RETURN",
    sourceId: purchaseReturn.id,
    sourceNumber: purchaseReturn.number,
    accountingDate: purchaseReturn.postedAt ?? purchaseReturn.returnDate,
    description: awaitingReplacement
      ? `Supplier replacement claim: ${purchaseReturn.number}.`
      : `Purchase return: ${purchaseReturn.number}.`,
    actorUserId,
    allowHistoricalBackfill,
    lines: [...debitLines, ...creditLines],
  });
  if (result.journalId && !awaitingReplacement && !allRejectedBeforePayable)
    await tx.supplierPayableLedgerEntry.upsert({
      where: { sourceKey: `PURCHASE_RETURN_CREDIT:${purchaseReturn.id}` },
      create: {
        sourceKey: `PURCHASE_RETURN_CREDIT:${purchaseReturn.id}`,
        supplierId: purchaseReturn.supplierId,
        entryType: "PURCHASE_RETURN_CREDIT",
        entryDate: purchaseReturn.postedAt ?? purchaseReturn.returnDate,
        signedAmount: payableCredit.negated().toFixed(),
        sourceType: "PURCHASE_RETURN",
        sourceId: purchaseReturn.id,
        sourceNumber: purchaseReturn.number,
        description: `Supplier payable credit for ${purchaseReturn.number}.`,
        journalId: result.journalId,
      },
      update: {},
    });
}

export async function postProductionCostAccounting(
  tx: Client,
  costEntryId: string,
  actorUserId: string,
  allowHistoricalBackfill = false,
) {
  const entry = await tx.productionCostEntry.findUnique({ where: { id: costEntryId } });
  if (!entry) return;
  const credit = entry.category === "COST_CREDIT";
  return postAutomaticJournal(tx, {
    sourceType: "PRODUCTION_COST",
    sourceId: entry.id,
    sourceNumber: entry.reference,
    accountingDate: entry.createdAt,
    description: `Production cost entry: ${entry.description}.`,
    actorUserId,
    allowHistoricalBackfill,
    lines: credit
      ? [
          {
            mapping: "PRODUCTION_COST_CLEARING",
            debit: entry.amount.toString(),
            productionBatchId: entry.productionBatchId,
          },
          {
            mapping: "WORK_IN_PROCESS",
            credit: entry.amount.toString(),
            productionBatchId: entry.productionBatchId,
          },
        ]
      : [
          {
            mapping: "WORK_IN_PROCESS",
            debit: entry.amount.toString(),
            productionBatchId: entry.productionBatchId,
          },
          {
            mapping: "PRODUCTION_COST_CLEARING",
            credit: entry.amount.toString(),
            productionBatchId: entry.productionBatchId,
          },
        ],
  });
}

export async function createManualJournalDraft(
  tx: Client,
  input: {
    accountingDate: Date;
    description: string;
    actorUserId: string;
    lines: readonly ManualJournalLineInput[];
  },
) {
  const prepared = await prepareManualLines(tx, input.lines);
  const totalDebit = sum(prepared.map((line) => line.debit));
  const totalCredit = sum(prepared.map((line) => line.credit));
  const sourceId = randomUUID();
  const journal = await tx.accountingJournal.create({
    data: {
      journalNumber: `DRAFT-${sourceId}`,
      accountingDate: input.accountingDate,
      sourceType: "MANUAL_JOURNAL",
      sourceId,
      description: input.description,
      status: "DRAFT",
      totalDebit: totalDebit.toFixed(6),
      totalCredit: totalCredit.toFixed(6),
      lines: {
        create: prepared.map((line, index) => ({
          position: index + 1,
          account: { connect: { id: line.accountId } },
          description: line.description ?? null,
          debit: line.debit.toFixed(6),
          credit: line.credit.toFixed(6),
        })),
      },
    },
  });
  await recordAuditEvent(tx, {
    actorUserId: input.actorUserId,
    action: "CREATE",
    entityType: "JOURNAL",
    entityId: journal.id,
    entityReference: journal.journalNumber,
    module: "accounting",
    description: "Created a draft manual journal.",
    afterSnapshot: {
      accountingDate: input.accountingDate.toISOString().slice(0, 10),
      totalDebit: totalDebit.toFixed(6),
      totalCredit: totalCredit.toFixed(6),
    },
  });
  return journal.id;
}

export async function postManualJournal(tx: Client, journalId: string, actorUserId: string) {
  const journal = await tx.accountingJournal.findUnique({
    where: { id: journalId },
    include: { lines: { include: { account: true } } },
  });
  if (!journal || journal.sourceType !== "MANUAL_JOURNAL" || journal.status !== "DRAFT")
    throw new AccountingPostingError("Only an existing draft manual journal may be posted.");
  const period = await tx.accountingPeriod.findFirst({
    where: {
      status: "OPEN",
      startDate: { lte: journal.accountingDate },
      endDate: { gte: journal.accountingDate },
    },
  });
  if (!period)
    throw new AccountingPostingError("No OPEN accounting period contains the journal date.");
  const lines = journal.lines.map((line) => ({
    debit: new Decimal(line.debit.toString()),
    credit: new Decimal(line.credit.toString()),
  }));
  validateLines(lines);
  if (
    journal.lines.some(
      (line) => !line.account.active || !line.account.postingAllowed || line.account.isControl,
    )
  )
    throw new AccountingPostingError(
      "Manual journals cannot post to inactive, non-posting, or control accounts.",
    );
  await tx.accountingJournal.update({
    where: { id: journal.id },
    data: {
      journalNumber: await nextJournalNumber(tx, journal.accountingDate.getUTCFullYear()),
      status: "POSTED",
      postedByUserId: actorUserId,
      postedAt: new Date(),
    },
  });
  await recordAuditEvent(tx, {
    actorUserId,
    action: "POST",
    entityType: "JOURNAL",
    entityId: journal.id,
    entityReference: journal.journalNumber,
    module: "accounting",
    description: "Posted a manual journal.",
    controlEvent: true,
  });
}

export async function reverseManualJournal(
  tx: Client,
  journalId: string,
  accountingDate: Date,
  reason: string,
  actorUserId: string,
) {
  const original = await tx.accountingJournal.findUnique({
    where: { id: journalId },
    include: { lines: true, reversalJournal: true },
  });
  if (
    !original ||
    original.sourceType !== "MANUAL_JOURNAL" ||
    original.status !== "POSTED" ||
    original.reversalJournal
  )
    throw new AccountingPostingError("Only an unreversed posted manual journal can be reversed.");
  const period = await tx.accountingPeriod.findFirst({
    where: { status: "OPEN", startDate: { lte: accountingDate }, endDate: { gte: accountingDate } },
  });
  if (!period)
    throw new AccountingPostingError("No OPEN accounting period contains the reversal date.");
  const number = await nextJournalNumber(tx, accountingDate.getUTCFullYear());
  const reversal = await tx.accountingJournal.create({
    data: {
      journalNumber: number,
      accountingDate,
      sourceType: "MANUAL_REVERSAL",
      sourceId: original.id,
      sourceNumber: original.journalNumber,
      description: `Reversal of ${original.journalNumber}: ${reason}`,
      status: "POSTED",
      totalDebit: original.totalCredit,
      totalCredit: original.totalDebit,
      postedByUserId: actorUserId,
      postedAt: new Date(),
      reversalOfId: original.id,
      lines: {
        create: original.lines.map((line) => ({
          position: line.position,
          account: { connect: { id: line.accountId } },
          description: `Reversal: ${line.description ?? ""}`,
          debit: line.credit,
          credit: line.debit,
        })),
      },
    },
  });
  await tx.accountingJournal.update({ where: { id: original.id }, data: { status: "REVERSED" } });
  await recordAuditEvent(tx, {
    actorUserId,
    action: "REVERSE",
    entityType: "JOURNAL",
    entityId: reversal.id,
    entityReference: reversal.journalNumber,
    module: "accounting",
    description: `Reversed manual journal ${original.journalNumber}.`,
    reasonCode: "ACCOUNTING_CORRECTION",
    reason,
    related: { entityType: "JOURNAL", entityId: original.id, reference: original.journalNumber },
    controlEvent: true,
  });
  return reversal.id;
}

export async function backfillAccounting(tx: Client, actorUserId: string) {
  const [
    valuations,
    invoices,
    payments,
    productionCosts,
    snapshots,
    receipts,
    salesReturns,
    purchaseReturns,
  ] = await Promise.all([
    tx.inventoryValuationEntry.findMany({ where: { state: "FINAL" }, select: { id: true } }),
    tx.salesInvoice.findMany({ where: { status: "POSTED" }, select: { id: true } }),
    tx.customerPayment.findMany({ where: { status: "POSTED" }, select: { id: true } }),
    tx.productionCostEntry.findMany({ select: { id: true } }),
    tx.productionBatchCostSnapshot.findMany({
      where: { status: "FINALIZED" },
      select: { id: true },
    }),
    tx.goodsReceipt.findMany({
      where: { status: "QC_COMPLETED", purpose: "PURCHASE" },
      select: { id: true },
    }),
    tx.salesReturn.findMany({
      where: { status: "COMPLETED", type: "INVOICED_RETURN" },
      select: { id: true },
    }),
    tx.purchaseReturn.findMany({
      where: { status: { in: ["POSTED", "AWAITING_REPLACEMENT", "COMPLETED"] } },
      select: { id: true },
    }),
  ]);
  for (const valuation of valuations)
    await postValuationAccounting(tx, valuation.id, actorUserId, true);
  for (const invoice of invoices)
    await postSalesInvoiceAccounting(tx, invoice.id, actorUserId, true);
  for (const payment of payments)
    await postCustomerPaymentAccounting(tx, payment.id, actorUserId, true);
  for (const cost of productionCosts)
    await postProductionCostAccounting(tx, cost.id, actorUserId, true);
  for (const snapshot of snapshots)
    await postFinalizedProductionAccounting(tx, snapshot.id, actorUserId, true);
  for (const receipt of receipts)
    await postGoodsReceiptAcceptanceAccounting(tx, receipt.id, actorUserId, true);
  for (const salesReturn of salesReturns)
    await postSalesReturnAccounting(tx, salesReturn.id, actorUserId, true);
  for (const purchaseReturn of purchaseReturns)
    await postPurchaseReturnAccounting(tx, purchaseReturn.id, actorUserId, true);
  const result = {
    processed:
      valuations.length +
      invoices.length +
      payments.length +
      productionCosts.length +
      snapshots.length +
      receipts.length +
      salesReturns.length +
      purchaseReturns.length,
  };
  await recordAuditEvent(tx, {
    actorUserId,
    action: "BACKFILL",
    entityType: "JOURNAL",
    entityId: "automatic-accounting-backfill",
    entityReference: "Automatic accounting backfill",
    module: "accounting",
    description: "Scanned posted source documents for missing automatic journals.",
    metadata: {
      ...result,
      valuationEntries: valuations.length,
      salesInvoices: invoices.length,
      customerPayments: payments.length,
      productionCosts: productionCosts.length,
      costingSnapshots: snapshots.length,
      goodsReceipts: receipts.length,
      salesReturns: salesReturns.length,
      purchaseReturns: purchaseReturns.length,
    },
    controlEvent: true,
  });
  return result;
}

export async function postFinalizedProductionAccounting(
  tx: Client,
  snapshotId: string,
  actorUserId: string,
  allowHistoricalBackfill = false,
) {
  const snapshot = await tx.productionBatchCostSnapshot.findUnique({
    where: { id: snapshotId },
    include: { productionBatch: true },
  });
  if (!snapshot) return;
  return postAutomaticJournal(tx, {
    sourceType: "PRODUCTION_OUTPUT",
    sourceId: snapshot.id,
    sourceNumber: snapshot.productionBatch.batchNumber,
    accountingDate: snapshot.finalizedAt,
    description: `Finished production cost transfer: ${snapshot.productionBatch.batchNumber}.`,
    actorUserId,
    allowHistoricalBackfill,
    lines: [
      {
        mapping: "FINISHED_GOODS_INVENTORY",
        debit: snapshot.finishedGoodsCostPool.toString(),
        productionBatchId: snapshot.productionBatchId,
      },
      {
        mapping: "WORK_IN_PROCESS",
        credit: snapshot.finishedGoodsCostPool.toString(),
        productionBatchId: snapshot.productionBatchId,
      },
    ],
  });
}

function inventoryMapping(itemType: string): AccountingMappingKey {
  if (itemType === "RAW_MATERIAL") return "RAW_MATERIAL_INVENTORY";
  if (itemType === "PACKAGING_MATERIAL") return "PACKAGING_INVENTORY";
  return "FINISHED_GOODS_INVENTORY";
}
export function accountingSourceAuditEntityType(sourceType: AccountingSourceType) {
  if (sourceType === "SALES_INVOICE_REVENUE" || sourceType === "SALES_INVOICE_COGS")
    return "SALES_INVOICE" as const;
  if (sourceType === "CUSTOMER_PAYMENT") return "CUSTOMER_PAYMENT" as const;
  if (sourceType === "SALES_RETURN_RECEIPT" || sourceType === "SALES_RETURN_CREDIT")
    return "SALES_RETURN" as const;
  if (sourceType === "GOODS_RECEIPT" || sourceType === "GOODS_RECEIPT_ACCEPTANCE")
    return "GRN" as const;
  if (sourceType === "PURCHASE_RETURN") return "PURCHASE_RETURN" as const;
  if (sourceType === "VALUATION_ADJUSTMENT") return "VALUATION_ADJUSTMENT" as const;
  if (
    sourceType === "PRODUCTION_OUTPUT" ||
    sourceType === "PRODUCTION_CONSUMPTION" ||
    sourceType === "PACKAGING_CONSUMPTION" ||
    sourceType === "PRODUCTION_COST"
  )
    return "COSTING_FINALIZATION" as const;
  return "JOURNAL" as const;
}
function amount(value: string | undefined) {
  return new Decimal(value ?? "0");
}
function sum(values: readonly Decimal[]) {
  return values.reduce((total, value) => total.add(value), new Decimal(0));
}
function validateLines(lines: readonly { debit: Decimal; credit: Decimal }[]) {
  if (lines.length < 2) throw new AccountingPostingError("A journal needs at least two lines.");
  for (const line of lines)
    if (
      line.debit.isNegative() ||
      line.credit.isNegative() ||
      line.debit.gt(0) === line.credit.gt(0)
    )
      throw new AccountingPostingError(
        "Each journal line must contain exactly one positive debit or credit.",
      );
  const debit = sum(lines.map((line) => line.debit));
  const credit = sum(lines.map((line) => line.credit));
  if (debit.lte(0) || !debit.eq(credit))
    throw new AccountingPostingError("Journal debits and credits must balance exactly.");
}
async function prepareManualLines(tx: Client, lines: readonly ManualJournalLineInput[]) {
  if (lines.length < 2)
    throw new AccountingPostingError("A manual journal needs at least two lines.");
  const accounts = await tx.accountingAccount.findMany({
    where: { id: { in: lines.map((line) => line.accountId) } },
  });
  if (accounts.length !== new Set(lines.map((line) => line.accountId)).size)
    throw new AccountingPostingError("A selected manual-journal account no longer exists.");
  if (accounts.some((account) => !account.active || !account.postingAllowed || account.isControl))
    throw new AccountingPostingError(
      "Manual journals cannot use inactive, non-posting, or control accounts.",
    );
  const prepared = lines.map((line) => ({
    ...line,
    debit: amount(line.debit),
    credit: amount(line.credit),
  }));
  validateLines(prepared);
  return prepared;
}
async function nextJournalNumber(tx: Client, year: number) {
  const sequence = await tx.accountingJournalSequence.upsert({
    where: { year },
    create: { year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return `JV-${year}-${String(sequence.nextValue - 1).padStart(6, "0")}`;
}
async function block(
  tx: Client,
  input: AutomaticJournalInput,
  sourceKey: string,
  reasonCode: string,
  description: string,
) {
  await tx.accountingPostingBlock.upsert({
    where: { sourceKey },
    create: {
      sourceKey,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      reasonCode,
      description,
      createdByUserId: input.actorUserId,
    },
    update: { reasonCode, description, resolvedAt: null },
  });
  await recordAuditEvent(tx, {
    actorUserId: input.actorUserId,
    action: "CONTROL_BLOCKED",
    entityType: accountingSourceAuditEntityType(input.sourceType),
    entityId: input.sourceId,
    entityReference: input.sourceNumber ?? null,
    module: "accounting",
    description: `Blocked automatic accounting: ${description}`,
    metadata: { reasonCode, sourceType: input.sourceType, sourceKey },
    controlEvent: true,
  });
  return { journalId: null, blocked: true };
}
