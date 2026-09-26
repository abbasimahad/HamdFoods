import "server-only";

import Decimal from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import {
  PurchasingRepositoryError,
  type PageResult,
  type SupplierRecord,
} from "@/modules/purchasing/application/contracts";
import type {
  EligibleGoodsReceiptLineForMatch,
  EligiblePurchaseOrderLineForInvoice,
  PurchaseInvoiceInput,
  PurchaseInvoiceLineMatchRecord,
  PurchaseInvoiceLineRecord,
  PurchaseInvoiceListRecord,
  PurchaseInvoiceQuery,
  PurchaseInvoiceRecord,
  PurchaseInvoiceRepository,
} from "@/modules/purchasing/application/purchase-invoice-contracts";
import {
  calculatePurchaseLine,
  calculatePurchaseTotals,
} from "@/modules/purchasing/domain/purchasing";
import {
  calculateGrnDerivedTax,
  calculateMatchTaxVariance,
  calculatePriceVariance,
  validateGrnLineNotOversubscribed,
  validateLineMatchCompleteness,
} from "@/modules/purchasing/domain/purchase-invoice";
import { prisma } from "@/server/db/prisma";
import { recordAuditEvent } from "@/server/audit/audit-event";
import {
  postPurchaseInvoiceVarianceAccounting,
  reversePurchaseInvoiceVarianceAccounting,
} from "@/server/accounting/transactional-accounting-posting";

const PURCHASE_INVOICE_PAGE_SIZE = 20;

const invoiceInclude = {
  supplier: true,
  createdBy: true,
  postedBy: true,
  cancelledBy: true,
  reversedBy: true,
  lines: {
    include: {
      item: true,
      purchaseOrderLine: { include: { purchaseOrder: true, canonicalUnit: true } },
      matches: { include: { goodsReceiptLine: { include: { goodsReceipt: true } } } },
    },
    orderBy: { position: "asc" as const },
  },
} satisfies Prisma.PurchaseInvoiceInclude;
type InvoiceRow = Prisma.PurchaseInvoiceGetPayload<{ include: typeof invoiceInclude }>;
type Client = Prisma.TransactionClient | typeof prisma;

export class PrismaPurchaseInvoiceRepository implements PurchaseInvoiceRepository {
  async listEligiblePurchaseOrderLines(): Promise<readonly EligiblePurchaseOrderLineForInvoice[]> {
    const lines = await prisma.purchaseOrderLine.findMany({
      where: {
        purchaseOrder: { status: { in: ["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"] } },
      },
      include: { purchaseOrder: { include: { supplier: true } }, item: true, canonicalUnit: true },
      orderBy: [{ purchaseOrder: { orderDate: "desc" } }, { position: "asc" }],
    });
    return lines.map((line) => ({
      purchaseOrderLineId: line.id,
      purchaseOrderId: line.purchaseOrderId,
      purchaseOrderNumber: line.purchaseOrder.number,
      supplierId: line.purchaseOrder.supplierId,
      supplierCode: line.purchaseOrder.supplier.code,
      supplierName: line.purchaseOrder.supplier.name,
      itemId: line.itemId,
      itemCode: line.item.code,
      itemName: line.item.name,
      canonicalUnitSymbol: line.canonicalUnit.symbol,
      orderedQuantity: line.normalizedQuantity.toString(),
      // The PO's own unitRate is quoted per order unit (e.g. per kg); the invoice's
      // quantity and matching are always in the canonical unit (e.g. grams), so the
      // default rate offered here must be converted to that same canonical basis --
      // otherwise the invoice total and its price variance mix two different units.
      poUnitRate: new Decimal(line.unitRate)
        .mul(line.orderedQuantity)
        .div(line.normalizedQuantity)
        .toString(),
      poTaxPercent: line.taxPercent.toString(),
    }));
  }

  async listEligibleGoodsReceiptLines(): Promise<readonly EligibleGoodsReceiptLineForMatch[]> {
    return eligibleGoodsReceiptLines(prisma);
  }

  async listInvoiceSuppliers(): Promise<readonly SupplierRecord[]> {
    return prisma.supplier.findMany({ orderBy: { name: "asc" } });
  }

  async createPurchaseInvoice(input: PurchaseInvoiceInput) {
    return serializable(async (transaction) => {
      const prepared = await prepareInvoice(transaction, input);
      const year = prepared.invoiceDate.getUTCFullYear();
      const number = await nextNumber(transaction, year);
      return (
        await transaction.purchaseInvoice.create({
          data: {
            number,
            supplierId: input.supplierId,
            supplierInvoiceNumber: input.supplierInvoiceNumber,
            invoiceDate: prepared.invoiceDate,
            dueDate: prepared.dueDate,
            notes: input.notes ?? null,
            subtotal: prepared.totals.subtotal,
            taxTotal: prepared.totals.taxTotal,
            grandTotal: prepared.totals.grandTotal,
            createdByUserId: input.actorUserId,
            lines: {
              create: prepared.lines.map((line, index) => ({
                position: index + 1,
                purchaseOrderLineId: line.purchaseOrderLineId,
                itemId: line.itemId,
                invoicedQuantity: line.invoicedQuantity,
                invoicedUnitRate: line.invoicedUnitRate,
                taxPercent: line.taxPercent,
                grossAmount: line.grossAmount,
                taxAmount: line.taxAmount,
                netAmount: line.netAmount,
                notes: line.notes,
                matches: {
                  create: line.matches.map((match) => ({
                    goodsReceiptLineId: match.goodsReceiptLineId,
                    matchedQuantity: match.matchedQuantity,
                  })),
                },
              })),
            },
          },
        })
      ).id;
    });
  }

  async updatePurchaseInvoice(input: PurchaseInvoiceInput & { id: string }) {
    return serializable(async (transaction) => {
      const existing = await transaction.purchaseInvoice.findUnique({ where: { id: input.id } });
      if (!existing || existing.status !== "DRAFT")
        throw new PurchasingRepositoryError(
          "invalid-state",
          "Only a draft purchase invoice can be edited.",
        );
      const prepared = await prepareInvoice(transaction, input);
      await transaction.purchaseInvoice.update({
        where: { id: input.id },
        data: {
          supplierId: input.supplierId,
          supplierInvoiceNumber: input.supplierInvoiceNumber,
          invoiceDate: prepared.invoiceDate,
          dueDate: prepared.dueDate,
          notes: input.notes ?? null,
          subtotal: prepared.totals.subtotal,
          taxTotal: prepared.totals.taxTotal,
          grandTotal: prepared.totals.grandTotal,
          lines: {
            deleteMany: {},
            create: prepared.lines.map((line, index) => ({
              position: index + 1,
              purchaseOrderLineId: line.purchaseOrderLineId,
              itemId: line.itemId,
              invoicedQuantity: line.invoicedQuantity,
              invoicedUnitRate: line.invoicedUnitRate,
              taxPercent: line.taxPercent,
              grossAmount: line.grossAmount,
              taxAmount: line.taxAmount,
              netAmount: line.netAmount,
              notes: line.notes,
              matches: {
                create: line.matches.map((match) => ({
                  goodsReceiptLineId: match.goodsReceiptLineId,
                  matchedQuantity: match.matchedQuantity,
                })),
              },
            })),
          },
        },
      });
      return input.id;
    });
  }

  async postPurchaseInvoice(id: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const invoice = await transaction.purchaseInvoice.findUnique({
        where: { id },
        include: {
          lines: {
            include: { purchaseOrderLine: true, matches: true },
            orderBy: { position: "asc" },
          },
        },
      });
      if (!invoice || invoice.status !== "DRAFT")
        throw new PurchasingRepositoryError(
          "invalid-state",
          "Only a draft purchase invoice can be posted.",
        );

      // 1) Every line must be exactly, fully matched -- zero tolerance, never partial.
      for (const [index, line] of invoice.lines.entries()) {
        const matchedTotal = sum(line.matches.map((match) => match.matchedQuantity.toString()));
        try {
          validateLineMatchCompleteness({
            invoicedQuantity: line.invoicedQuantity.toString(),
            matchedQuantityTotal: matchedTotal,
          });
        } catch (error) {
          throw new PurchasingRepositoryError(
            "invalid-state",
            error instanceof Error
              ? `Line ${index + 1}: ${error.message}`
              : `Line ${index + 1} is not fully matched.`,
          );
        }
      }
      if (invoice.lines.every((line) => line.matches.length === 0))
        throw new PurchasingRepositoryError(
          "invalid-state",
          "At least one line must be matched to a received goods receipt line before posting.",
        );

      // 2) Re-read GRN availability transactionally -- no other POSTED invoice may
      //    have already claimed more than QC accepted, combined with this invoice.
      const grnLineIds = [
        ...new Set(
          invoice.lines.flatMap((line) => line.matches.map((match) => match.goodsReceiptLineId)),
        ),
      ];
      const [otherMatches, qcDecisions] = await Promise.all([
        transaction.purchaseInvoiceLineMatch.groupBy({
          by: ["goodsReceiptLineId"],
          where: {
            goodsReceiptLineId: { in: grnLineIds },
            purchaseInvoiceLine: {
              purchaseInvoiceId: { not: id },
              purchaseInvoice: { status: "POSTED" },
            },
          },
          _sum: { matchedQuantity: true },
        }),
        transaction.goodsReceiptQcDecision.findMany({
          where: { goodsReceiptLineId: { in: grnLineIds } },
        }),
      ]);
      const otherMap = new Map(
        otherMatches.map((row) => [
          row.goodsReceiptLineId,
          row._sum.matchedQuantity?.toString() ?? "0",
        ]),
      );
      const acceptedMap = new Map(
        qcDecisions.map((decision) => [
          decision.goodsReceiptLineId,
          decision.acceptedQuantity.toString(),
        ]),
      );
      for (const grnLineId of grnLineIds) {
        const mine = sum(
          invoice.lines.flatMap((line) =>
            line.matches
              .filter((match) => match.goodsReceiptLineId === grnLineId)
              .map((match) => match.matchedQuantity.toString()),
          ),
        );
        validateGrnLineNotOversubscribed({
          acceptedQuantity: acceptedMap.get(grnLineId) ?? "0",
          matchedByOtherPostedInvoices: otherMap.get(grnLineId) ?? "0",
          matchedByThisInvoice: mine,
        });
      }

      // 3) Freeze price/tax variance on every match while the header is still
      //    DRAFT (the DB guard allows match mutation only in that state).
      const valuations = grnLineIds.length
        ? await transaction.inventoryValuationEntry.findMany({
            where: {
              sourceKey: { in: grnLineIds.map((lineId) => `GRN-COST:${lineId}`) },
              entryType: "PURCHASE_RECEIPT",
              state: "FINAL",
            },
            select: { sourceKey: true, unitCost: true },
          })
        : [];
      const unitCostMap = new Map(
        valuations.map((entry) => [
          entry.sourceKey.replace("GRN-COST:", ""),
          entry.unitCost?.toString() ?? null,
        ]),
      );
      let priceVarianceTotal = new Decimal(0);
      let taxVarianceTotal = new Decimal(0);
      for (const line of invoice.lines) {
        for (const match of line.matches) {
          const grnUnitCost = unitCostMap.get(match.goodsReceiptLineId);
          if (!grnUnitCost)
            throw new PurchasingRepositoryError(
              "invalid-reference",
              "Goods receipt valuation is missing for a matched line.",
            );
          const grnDerivedTaxAmount = calculateGrnDerivedTax({
            grnUnitCost,
            matchedQuantity: match.matchedQuantity.toString(),
            purchaseOrderLineNetAmount: line.purchaseOrderLine.netAmount.toString(),
            purchaseOrderLineTaxAmount: line.purchaseOrderLine.taxAmount.toString(),
          });
          const priceVarianceAmount = calculatePriceVariance({
            invoicedUnitRate: line.invoicedUnitRate.toString(),
            grnUnitCost,
            matchedQuantity: match.matchedQuantity.toString(),
          });
          const taxVarianceAmount = calculateMatchTaxVariance({
            invoiceLineTaxAmount: line.taxAmount.toString(),
            invoiceLineInvoicedQuantity: line.invoicedQuantity.toString(),
            matchedQuantity: match.matchedQuantity.toString(),
            grnDerivedTaxAmount,
          });
          await transaction.purchaseInvoiceLineMatch.update({
            where: { id: match.id },
            data: {
              grnDerivedUnitCost: grnUnitCost,
              grnDerivedTaxAmount,
              priceVarianceAmount,
              taxVarianceAmount,
            },
          });
          priceVarianceTotal = priceVarianceTotal.add(priceVarianceAmount);
          taxVarianceTotal = taxVarianceTotal.add(taxVarianceAmount);
        }
      }

      // 4) Claim POSTED -- the idempotency root. A losing concurrent POST (or a
      //    retried duplicate submission) finds count !== 1 and throws cleanly
      //    with nothing else having been committed.
      const claimed = await transaction.purchaseInvoice.updateMany({
        where: { id, status: "DRAFT" },
        data: {
          status: "POSTED",
          postedByUserId: actorUserId,
          postedAt: new Date(),
          priceVarianceTotal: priceVarianceTotal.toFixed(6),
          taxVarianceTotal: taxVarianceTotal.toFixed(6),
        },
      });
      if (claimed.count !== 1)
        throw new PurchasingRepositoryError(
          "invalid-state",
          "Purchase invoice is no longer a draft; reload and retry.",
        );

      // 5) Post only the delta -- exact match posts nothing.
      const accounting = await postPurchaseInvoiceVarianceAccounting(transaction, id, actorUserId);

      await recordAuditEvent(transaction, {
        actorUserId,
        action: "POST",
        entityType: "PURCHASE_INVOICE",
        entityId: id,
        entityReference: invoice.number,
        module: "purchasing",
        description: `Posted purchase invoice ${invoice.number} (${invoice.supplierInvoiceNumber}).`,
        metadata: {
          lineCount: invoice.lines.length,
          priceVarianceTotal: priceVarianceTotal.toFixed(6),
          taxVarianceTotal: taxVarianceTotal.toFixed(6),
          journalId: accounting.journalId,
          blocked: accounting.blocked,
        },
        beforeSnapshot: { status: "DRAFT" },
        afterSnapshot: { status: "POSTED" },
        controlEvent: true,
      });
    });
  }

  async cancelPurchaseInvoice(id: string, reason: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const invoice = await transaction.purchaseInvoice.findUnique({
        where: { id },
        select: { number: true, status: true },
      });
      const result = await transaction.purchaseInvoice.updateMany({
        where: { id, status: "DRAFT" },
        data: {
          status: "CANCELLED",
          cancelledByUserId: actorUserId,
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
      });
      if (result.count !== 1)
        throw new PurchasingRepositoryError(
          "invalid-state",
          "Only an existing draft purchase invoice can be cancelled.",
        );
      await recordAuditEvent(transaction, {
        actorUserId,
        action: "CANCEL",
        entityType: "PURCHASE_INVOICE",
        entityId: id,
        entityReference: invoice?.number ?? null,
        module: "purchasing",
        description: `Cancelled draft purchase invoice ${invoice?.number ?? id}.`,
        reasonCode: "OPERATIONAL_CORRECTION",
        reason,
        beforeSnapshot: { status: invoice?.status ?? "DRAFT" },
        afterSnapshot: { status: "CANCELLED" },
        controlEvent: true,
      });
    });
  }

  async reversePurchaseInvoice(id: string, reason: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const invoice = await transaction.purchaseInvoice.findUnique({ where: { id } });
      if (!invoice || invoice.status !== "POSTED")
        throw new PurchasingRepositoryError(
          "invalid-state",
          "Only a posted purchase invoice can be reversed.",
        );
      const reversalDate = new Date();
      // Compensation posts (and may throw on a closed period) before the
      // header ever flips to REVERSED -- a failure here rolls back everything.
      const { journalId } = await reversePurchaseInvoiceVarianceAccounting(
        transaction,
        id,
        actorUserId,
        reversalDate,
        reason,
      );
      const claimed = await transaction.purchaseInvoice.updateMany({
        where: { id, status: "POSTED" },
        data: {
          status: "REVERSED",
          reversedByUserId: actorUserId,
          reversedAt: new Date(),
          reversalReason: reason,
        },
      });
      if (claimed.count !== 1)
        throw new PurchasingRepositoryError(
          "invalid-state",
          "Purchase invoice is no longer posted; reload and retry.",
        );
      await recordAuditEvent(transaction, {
        actorUserId,
        action: "REVERSE",
        entityType: "PURCHASE_INVOICE",
        entityId: id,
        entityReference: invoice.number,
        module: "purchasing",
        description: `Reversed purchase invoice ${invoice.number}.`,
        reasonCode: "ACCOUNTING_CORRECTION",
        reason,
        beforeSnapshot: { status: "POSTED" },
        afterSnapshot: { status: "REVERSED" },
        metadata: { journalId },
        controlEvent: true,
      });
    });
  }

  async getPurchaseInvoice(id: string): Promise<PurchaseInvoiceRecord | null> {
    const row = await prisma.purchaseInvoice.findUnique({ where: { id }, include: invoiceInclude });
    return row ? mapInvoice(row) : null;
  }

  async listPurchaseInvoices(
    query: PurchaseInvoiceQuery,
  ): Promise<PageResult<PurchaseInvoiceListRecord>> {
    const where = {
      ...(query.query
        ? {
            OR: [
              { number: { contains: query.query, mode: "insensitive" as const } },
              { supplierInvoiceNumber: { contains: query.query, mode: "insensitive" as const } },
              { supplier: { name: { contains: query.query, mode: "insensitive" as const } } },
            ],
          }
        : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            invoiceDate: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lt: query.dateTo } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await prisma.$transaction([
      prisma.purchaseInvoice.count({ where }),
      prisma.purchaseInvoice.findMany({
        where,
        include: invoiceInclude,
        orderBy: [{ invoiceDate: "desc" }, { number: "desc" }],
        skip: (query.page - 1) * PURCHASE_INVOICE_PAGE_SIZE,
        take: PURCHASE_INVOICE_PAGE_SIZE,
      }),
    ]);
    return {
      records: rows.map(mapInvoice),
      page: query.page,
      pageCount: Math.max(1, Math.ceil(total / PURCHASE_INVOICE_PAGE_SIZE)),
      total,
    };
  }
}

async function eligibleGoodsReceiptLines(
  client: Client,
): Promise<readonly EligibleGoodsReceiptLineForMatch[]> {
  const lines = await client.goodsReceiptLine.findMany({
    where: {
      goodsReceipt: { status: "QC_COMPLETED", purpose: "PURCHASE" },
      qcDecision: { acceptedQuantity: { gt: 0 } },
    },
    include: { goodsReceipt: true, qcDecision: true },
  });
  if (!lines.length) return [];
  const lineIds = lines.map((line) => line.id);
  const [matchSums, valuations] = await Promise.all([
    client.purchaseInvoiceLineMatch.groupBy({
      by: ["goodsReceiptLineId"],
      where: {
        goodsReceiptLineId: { in: lineIds },
        purchaseInvoiceLine: { purchaseInvoice: { status: "POSTED" } },
      },
      _sum: { matchedQuantity: true },
    }),
    client.inventoryValuationEntry.findMany({
      where: {
        sourceKey: { in: lineIds.map((id) => `GRN-COST:${id}`) },
        entryType: "PURCHASE_RECEIPT",
        state: "FINAL",
      },
      select: { sourceKey: true, unitCost: true },
    }),
  ]);
  const matchedMap = new Map(
    matchSums.map((row) => [row.goodsReceiptLineId, row._sum.matchedQuantity?.toString() ?? "0"]),
  );
  const unitCostMap = new Map(
    valuations.map((entry) => [
      entry.sourceKey.replace("GRN-COST:", ""),
      entry.unitCost?.toString() ?? "0",
    ]),
  );
  return lines
    .map((line) => {
      const accepted = line.qcDecision!.acceptedQuantity.toString();
      const matchedToDate = matchedMap.get(line.id) ?? "0";
      const remainingToInvoice = Decimal.max(new Decimal(accepted).sub(matchedToDate), 0).toFixed();
      return {
        goodsReceiptLineId: line.id,
        goodsReceiptId: line.goodsReceiptId,
        goodsReceiptNumber: line.goodsReceipt.number,
        purchaseOrderLineId: line.purchaseOrderLineId,
        itemId: line.itemId,
        acceptedQuantity: accepted,
        matchedToDate,
        remainingToInvoice,
        grnDerivedUnitCost: unitCostMap.get(line.id) ?? "0",
      };
    })
    .filter((row) => new Decimal(row.remainingToInvoice).gt(0));
}

async function prepareInvoice(transaction: Prisma.TransactionClient, input: PurchaseInvoiceInput) {
  const invoiceDate = dateOnly(input.invoiceDate, "Invoice date");
  const dueDate = input.dueDate ? dateOnly(input.dueDate, "Due date") : null;
  const poLines = await transaction.purchaseOrderLine.findMany({
    where: { id: { in: input.lines.map((line) => line.purchaseOrderLineId) } },
    include: { purchaseOrder: true },
  });
  const lines = input.lines.map((line, index) => {
    const poLine = poLines.find((candidate) => candidate.id === line.purchaseOrderLineId);
    if (!poLine || poLine.purchaseOrder.supplierId !== input.supplierId)
      throw new PurchasingRepositoryError(
        "invalid-reference",
        `Line ${index + 1} references a purchase order line outside the selected supplier.`,
      );
    const calculated = calculatePurchaseLine({
      quantity: line.invoicedQuantity,
      unitRate: line.invoicedUnitRate,
      discountPercent: "0",
      taxPercent: line.taxPercent,
    });
    const seenGrnLines = new Set<string>();
    const matches = line.matches.map((match) => {
      if (seenGrnLines.has(match.goodsReceiptLineId))
        throw new PurchasingRepositoryError(
          "invalid-reference",
          `Line ${index + 1} matches the same goods receipt line more than once.`,
        );
      seenGrnLines.add(match.goodsReceiptLineId);
      return {
        goodsReceiptLineId: match.goodsReceiptLineId,
        matchedQuantity: positive(match.matchedQuantity, "Matched quantity"),
      };
    });
    return {
      purchaseOrderLineId: line.purchaseOrderLineId,
      itemId: poLine.itemId,
      invoicedQuantity: new Decimal(line.invoicedQuantity).toFixed(),
      invoicedUnitRate: new Decimal(line.invoicedUnitRate).toFixed(),
      taxPercent: new Decimal(line.taxPercent || "0").toFixed(),
      grossAmount: calculated.grossAmount,
      taxAmount: calculated.taxAmount,
      netAmount: calculated.netAmount,
      notes: line.notes ?? null,
      matches,
    };
  });
  const totals = calculatePurchaseTotals(
    lines.map((line) => ({
      grossAmount: line.grossAmount,
      discountAmount: "0",
      taxAmount: line.taxAmount,
      netAmount: line.netAmount,
    })),
  );
  return { invoiceDate, dueDate, lines, totals };
}

function mapInvoice(row: InvoiceRow): PurchaseInvoiceRecord {
  return {
    id: row.id,
    number: row.number,
    supplierId: row.supplierId,
    supplierCode: row.supplier.code,
    supplierName: row.supplier.name,
    supplierInvoiceNumber: row.supplierInvoiceNumber,
    invoiceDate: row.invoiceDate,
    dueDate: row.dueDate,
    status: row.status,
    notes: row.notes,
    subtotal: row.subtotal.toFixed(6),
    taxTotal: row.taxTotal.toFixed(6),
    grandTotal: row.grandTotal.toFixed(6),
    priceVarianceTotal: row.priceVarianceTotal.toFixed(6),
    taxVarianceTotal: row.taxVarianceTotal.toFixed(6),
    createdByName: row.createdBy.name,
    postedByName: row.postedBy?.name ?? null,
    postedAt: row.postedAt,
    cancelledByName: row.cancelledBy?.name ?? null,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    reversedByName: row.reversedBy?.name ?? null,
    reversedAt: row.reversedAt,
    reversalReason: row.reversalReason,
    createdAt: row.createdAt,
    lines: row.lines.map((line): PurchaseInvoiceLineRecord => {
      const matchedQuantityTotal = new Decimal(
        sum(line.matches.map((match) => match.matchedQuantity.toString())),
      ).toFixed(6);
      return {
        id: line.id,
        position: line.position,
        purchaseOrderLineId: line.purchaseOrderLineId,
        purchaseOrderNumber: line.purchaseOrderLine.purchaseOrder.number,
        itemId: line.itemId,
        itemCode: line.item.code,
        itemName: line.item.name,
        canonicalUnitSymbol: line.purchaseOrderLine.canonicalUnit.symbol,
        invoicedQuantity: line.invoicedQuantity.toFixed(6),
        invoicedUnitRate: line.invoicedUnitRate.toFixed(6),
        taxPercent: line.taxPercent.toFixed(4),
        grossAmount: line.grossAmount.toFixed(6),
        taxAmount: line.taxAmount.toFixed(6),
        netAmount: line.netAmount.toFixed(6),
        notes: line.notes,
        matchedQuantityTotal,
        matches: line.matches.map((match): PurchaseInvoiceLineMatchRecord => ({
          id: match.id,
          goodsReceiptLineId: match.goodsReceiptLineId,
          goodsReceiptNumber: match.goodsReceiptLine.goodsReceipt.number,
          matchedQuantity: match.matchedQuantity.toFixed(6),
          grnDerivedUnitCost: match.grnDerivedUnitCost.toFixed(12),
          grnDerivedTaxAmount: match.grnDerivedTaxAmount.toFixed(6),
          priceVarianceAmount: match.priceVarianceAmount.toFixed(6),
          taxVarianceAmount: match.taxVarianceAmount.toFixed(6),
        })),
      };
    }),
  };
}

async function nextNumber(transaction: Prisma.TransactionClient, year: number) {
  const sequence = await transaction.purchaseInvoiceSequence.upsert({
    where: { year },
    create: { year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return `PI-${year}-${String(sequence.nextValue - 1).padStart(6, "0")}`;
}
function positive(value: string, label: string) {
  let amount: Decimal;
  try {
    amount = new Decimal(value);
  } catch {
    throw new PurchasingRepositoryError("invalid-reference", `${label} is invalid.`);
  }
  if (
    !amount.isFinite() ||
    amount.lte(0) ||
    amount.decimalPlaces() > 6 ||
    amount.gt("999999999999999999.999999")
  )
    throw new PurchasingRepositoryError(
      "invalid-reference",
      `${label} is outside the supported range.`,
    );
  return amount.toFixed();
}
function dateOnly(value: string, label: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new PurchasingRepositoryError("invalid-reference", `${label} is invalid.`);
  return date;
}
function sum(values: readonly string[]) {
  return values.reduce((total, value) => total.add(value), new Decimal(0)).toFixed();
}
async function serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === 3) throw mapError(error);
    }
  }
  throw new PurchasingRepositoryError("conflict", "Purchase invoice transaction conflict; retry.");
}
function mapError(error: unknown) {
  if (error instanceof PurchasingRepositoryError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return new PurchasingRepositoryError(
        "conflict",
        "An invoice with this supplier and invoice number already exists.",
      );
    if (["P2003", "P2004"].includes(error.code))
      return new PurchasingRepositoryError(
        "invalid-reference",
        "Purchase invoice data conflicts with protected references.",
      );
  }
  return error instanceof Error
    ? error
    : new PurchasingRepositoryError("conflict", "Purchase invoice operation failed.");
}
