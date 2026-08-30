import "server-only";

import Decimal from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import { InventoryRepositoryError } from "@/modules/inventory/application/contracts";
import { normalizeCartonQuantity } from "@/modules/quantity/domain/cartons";
import {
  calculateSalesOrderLine,
  SALES_ORDER_PAGE_SIZE,
} from "@/modules/sales/domain/sales-orders";
import { inspectionClassificationsReconcile } from "@/modules/sales/domain/sales-return-inspection";
import type {
  ReturnInspectionInput,
  SalesReturnInput,
  SalesReturnPage,
  SalesReturnQuery,
  SalesReturnRecord,
  SalesReturnReferences,
  SalesReturnRepository,
  SalesReturnSource,
} from "@/modules/sales/application/sales-return-contracts";
import { SalesReturnRepositoryError } from "@/modules/sales/application/sales-return-contracts";
import {
  inspectSalesReturnInventory,
  receiveSalesReturnInventory,
} from "@/server/inventory/transactional-inventory-posting";
import { prisma } from "@/server/db/prisma";
import { valueSalesReturnReceipt } from "@/server/costing/prisma-inventory-valuation-repository";
import { postSalesReturnAccounting } from "@/server/accounting/transactional-accounting-posting";
import { recordAuditEvent } from "@/server/audit/audit-event";

const liveReturnStatuses = ["RECEIVED", "INSPECTED", "COMPLETED"] as const;
const returnInclude = {
  customer: true,
  salesInvoice: true,
  salesOrder: true,
  salesDispatch: true,
  receivingWarehouse: true,
  createdBy: true,
  receivedBy: true,
  inspectedBy: true,
  completedBy: true,
  cancelledBy: true,
  lines: {
    orderBy: { id: "asc" as const },
    include: {
      item: { include: { finishedGoodProfile: true } },
      productionLot: true,
      salesDispatchAllocation: { include: { productionLot: true } },
      inspections: { include: { createdBy: true }, orderBy: { createdAt: "asc" as const } },
    },
  },
} satisfies Prisma.SalesReturnInclude;
type ReturnRow = Prisma.SalesReturnGetPayload<{ include: typeof returnInclude }>;

export class PrismaSalesReturnRepository implements SalesReturnRepository {
  async getSalesReturnReferences(): Promise<SalesReturnReferences> {
    const [invoices, dispatches, warehouses, customers] = await Promise.all([
      prisma.salesInvoice.findMany({
        where: { status: "POSTED" },
        include: {
          customer: true,
          lines: { select: { salesDispatch: { select: { id: true, number: true } } } },
        },
        orderBy: [{ invoiceDate: "desc" }, { number: "desc" }],
        take: 1000,
      }),
      prisma.salesDispatch.findMany({
        where: { status: { in: ["POSTED", "DELIVERED"] } },
        include: { customer: true },
        orderBy: [{ dispatchAt: "desc" }, { number: "desc" }],
        take: 1000,
      }),
      prisma.warehouse.findMany({
        where: { active: true },
        select: { id: true, code: true, name: true },
        orderBy: [{ name: "asc" }, { code: "asc" }],
        take: 1000,
      }),
      prisma.customer.findMany({
        where: { active: true },
        select: { id: true, code: true, name: true },
        orderBy: [{ name: "asc" }, { code: "asc" }],
        take: 1000,
      }),
    ]);
    return {
      invoices: invoices.map((row) => ({
        id: row.id,
        number: row.number,
        customerName: row.customer.name,
        dispatches: [
          ...new Map(row.lines.map((line) => [line.salesDispatch.id, line.salesDispatch])).values(),
        ],
      })),
      dispatches: dispatches.map((row) => ({
        id: row.id,
        number: row.number,
        customerName: row.customer.name,
      })),
      warehouses,
      customers,
    };
  }

  async getInvoicedReturnSource(invoiceId: string, dispatchId?: string) {
    return invoicedSource(prisma, invoiceId, dispatchId);
  }
  async getDispatchRefusalSource(dispatchId: string) {
    return refusalSource(prisma, dispatchId);
  }
  async createSalesReturn(input: SalesReturnInput) {
    return serializable((tx) => saveReturn(tx, input));
  }
  async updateSalesReturn(input: SalesReturnInput & { id: string }) {
    return serializable(async (tx) => {
      const current = await tx.salesReturn.findUnique({
        where: { id: input.id },
        select: { status: true },
      });
      if (!current) throw issue("not-found", "Sales return no longer exists.");
      if (current.status !== "DRAFT")
        throw issue("invalid-state", "Only draft sales returns can be edited.");
      return saveReturn(tx, input);
    });
  }
  async getSalesReturn(id: string) {
    const row = await prisma.salesReturn.findUnique({ where: { id }, include: returnInclude });
    return row ? mapReturn(row) : null;
  }
  async listSalesReturns(
    query: SalesReturnQuery,
  ): Promise<SalesReturnPage<Omit<SalesReturnRecord, "lines">>> {
    const where = {
      ...(query.query
        ? {
            OR: [
              { number: { contains: query.query, mode: "insensitive" as const } },
              { customer: { name: { contains: query.query, mode: "insensitive" as const } } },
              { salesInvoice: { number: { contains: query.query, mode: "insensitive" as const } } },
              {
                salesDispatch: { number: { contains: query.query, mode: "insensitive" as const } },
              },
            ],
          }
        : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.salesInvoiceId ? { salesInvoiceId: query.salesInvoiceId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            returnAt: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lte: query.dateTo } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await prisma.$transaction([
      prisma.salesReturn.count({ where }),
      prisma.salesReturn.findMany({
        where,
        include: returnInclude,
        orderBy: [{ returnAt: "desc" }, { number: "desc" }],
        skip: (query.page - 1) * SALES_ORDER_PAGE_SIZE,
        take: SALES_ORDER_PAGE_SIZE,
      }),
    ]);
    return {
      records: rows.map((row) => {
        const { lines, ...record } = mapReturn(row);
        void lines;
        return record;
      }),
      total,
      page: query.page,
      pageCount: Math.max(1, Math.ceil(total / SALES_ORDER_PAGE_SIZE)),
    };
  }

  async receiveSalesReturn(id: string, actorUserId: string) {
    await serializable(async (tx) => {
      const salesReturn = await tx.salesReturn.findUnique({
        where: { id },
        include: returnInclude,
      });
      if (!salesReturn) throw issue("not-found", "Sales return no longer exists.");
      if (salesReturn.status !== "DRAFT")
        throw issue("invalid-state", "Only a draft sales return can be received.");
      const source =
        salesReturn.type === "INVOICED_RETURN"
          ? await invoicedSource(tx, salesReturn.salesInvoiceId!, salesReturn.salesDispatchId)
          : await refusalSource(tx, salesReturn.salesDispatchId);
      if (!source)
        throw issue(
          "invalid-reference",
          "The original sales source is no longer eligible for this return.",
        );
      validateSavedLines(salesReturn, source);
      await receiveSalesReturnInventory(
        tx,
        salesReturn.lines.map((line) => ({
          salesReturnId: salesReturn.id,
          salesReturnNumber: salesReturn.number,
          salesReturnLineId: line.id,
          type: salesReturn.type,
          salesInvoiceId: salesReturn.salesInvoiceId ?? undefined,
          salesInvoiceLineId: line.salesInvoiceLineId ?? undefined,
          salesOrderId: salesReturn.salesOrderId,
          salesDispatchId: salesReturn.salesDispatchId,
          salesDispatchLineId: line.salesDispatchLineId,
          salesDispatchAllocationId: line.salesDispatchAllocationId,
          itemId: line.itemId,
          warehouseId: salesReturn.receivingWarehouseId,
          canonicalUnitId: line.canonicalUnitId,
          productionLotId: line.productionLotId,
          quantity: line.totalPieces.toString(),
          actorUserId,
        })),
      );
      await valueSalesReturnReceipt(tx, salesReturn.id, actorUserId);
      await tx.salesReturn.update({
        where: { id },
        data: { status: "RECEIVED", receivedByUserId: actorUserId, receivedAt: new Date() },
      });
      await recordAuditEvent(tx, {
        actorUserId,
        action: "POST",
        entityType: "SALES_RETURN",
        entityId: salesReturn.id,
        entityReference: salesReturn.number,
        module: "sales",
        description: `Received sales return ${salesReturn.number}.`,
        metadata: { type: salesReturn.type, lineCount: salesReturn.lines.length },
        beforeSnapshot: { status: salesReturn.status },
        afterSnapshot: { status: "RECEIVED" },
        related: salesReturn.salesInvoiceId
          ? { entityType: "SALES_INVOICE", entityId: salesReturn.salesInvoiceId }
          : { entityType: "DISPATCH", entityId: salesReturn.salesDispatchId },
        controlEvent: true,
      });
    });
  }

  async inspectSalesReturn(
    id: string,
    entries: readonly ReturnInspectionInput[],
    actorUserId: string,
  ) {
    await serializable(async (tx) => {
      const salesReturn = await tx.salesReturn.findUnique({
        where: { id },
        include: returnInclude,
      });
      if (!salesReturn) throw issue("not-found", "Sales return no longer exists.");
      if (salesReturn.status !== "RECEIVED")
        throw issue("invalid-state", "Only a received sales return can be inspected.");
      const prepared = prepareInspections(salesReturn, entries);
      const created = [] as {
        id: string;
        lineId: string;
        classification: ReturnInspectionInput["classification"];
        quantity: string;
        reason: string;
      }[];
      for (const entry of prepared) {
        const inspection = await tx.salesReturnInspection.create({
          data: {
            salesReturnLineId: entry.salesReturnLineId,
            classification: entry.classification,
            quantity: entry.quantity,
            reason: entry.reason ?? null,
            notes: entry.notes ?? null,
            createdByUserId: actorUserId,
          },
        });
        created.push({
          id: inspection.id,
          lineId: entry.salesReturnLineId,
          classification: entry.classification,
          quantity: entry.quantity,
          reason: entry.reason ?? `Return inspection ${entry.classification}.`,
        });
      }
      await inspectSalesReturnInventory(
        tx,
        created.map((entry) => {
          const line = salesReturn.lines.find((candidate) => candidate.id === entry.lineId)!;
          return {
            salesReturnId: salesReturn.id,
            salesReturnNumber: salesReturn.number,
            salesReturnLineId: line.id,
            salesReturnInspectionId: entry.id,
            salesInvoiceId: salesReturn.salesInvoiceId ?? undefined,
            salesInvoiceLineId: line.salesInvoiceLineId ?? undefined,
            salesOrderId: salesReturn.salesOrderId,
            salesDispatchId: salesReturn.salesDispatchId,
            salesDispatchLineId: line.salesDispatchLineId,
            salesDispatchAllocationId: line.salesDispatchAllocationId,
            itemId: line.itemId,
            warehouseId: salesReturn.receivingWarehouseId,
            canonicalUnitId: line.canonicalUnitId,
            productionLotId: line.productionLotId,
            quantity: entry.quantity,
            classification: entry.classification,
            reason: entry.reason,
            actorUserId,
          };
        }),
      );
      await tx.salesReturn.update({
        where: { id },
        data:
          salesReturn.type === "DISPATCH_REFUSAL"
            ? {
                status: "COMPLETED",
                inspectedByUserId: actorUserId,
                inspectedAt: new Date(),
                completedByUserId: actorUserId,
                completedAt: new Date(),
              }
            : { status: "INSPECTED", inspectedByUserId: actorUserId, inspectedAt: new Date() },
      });
      if (salesReturn.type === "DISPATCH_REFUSAL")
        await tx.salesOrder.update({
          where: { id: salesReturn.salesOrderId },
          data: { status: "PARTIALLY_DISPATCHED" },
        });
      const completedRefusal = salesReturn.type === "DISPATCH_REFUSAL";
      await recordAuditEvent(tx, {
        actorUserId,
        action: "COMPLETE",
        entityType: "SALES_RETURN",
        entityId: salesReturn.id,
        entityReference: salesReturn.number,
        module: "sales",
        description: `${completedRefusal ? "Inspected and completed" : "Inspected"} sales return ${salesReturn.number}.`,
        metadata: {
          type: salesReturn.type,
          inspectionCount: created.length,
          classifications: created.map((entry) => ({
            classification: entry.classification,
            quantity: entry.quantity,
          })),
        },
        beforeSnapshot: { status: salesReturn.status },
        afterSnapshot: { status: completedRefusal ? "COMPLETED" : "INSPECTED" },
        controlEvent: true,
      });
    });
  }

  async completeSalesReturn(id: string, actorUserId: string) {
    await serializable(async (tx) => {
      const salesReturn = await tx.salesReturn.findUnique({
        where: { id },
        include: {
          lines: true,
          ledgerEntry: true,
          salesInvoice: {
            include: { lines: { include: { item: { include: { finishedGoodProfile: true } } } } },
          },
        },
      });
      if (!salesReturn) throw issue("not-found", "Sales return no longer exists.");
      if (salesReturn.type !== "INVOICED_RETURN" || salesReturn.status !== "INSPECTED")
        throw issue(
          "invalid-state",
          "Only an inspected invoiced return can be financially completed.",
        );
      if (salesReturn.ledgerEntry)
        throw issue("invalid-state", "This return already has a customer credit.");
      if (!salesReturn.salesInvoice || salesReturn.salesInvoice.status !== "POSTED")
        throw issue(
          "invalid-reference",
          "The original posted invoice is required to complete this return.",
        );
      const credit = sum(
        salesReturn.lines.map((returnLine) => {
          const invoiceLine = salesReturn.salesInvoice!.lines.find(
            (candidate) => candidate.id === returnLine.salesInvoiceLineId,
          );
          if (!invoiceLine?.item.finishedGoodProfile)
            throw issue(
              "invalid-reference",
              "A return line no longer has a valid posted invoice source.",
            );
          const recalculated = calculateSalesOrderLine({
            cartons: returnLine.cartons.toString(),
            loosePieces: returnLine.loosePieces.toString(),
            piecesPerCarton: invoiceLine.item.finishedGoodProfile.piecesPerCarton,
            cartonRate: invoiceLine.cartonRate.toString(),
            discount1Percent: invoiceLine.discount1Percent.toString(),
            discount2Percent: invoiceLine.discount2Percent.toString(),
            taxPercent: invoiceLine.taxPercent.toString(),
          });
          if (
            !returnLine.netAmount ||
            !new Decimal(returnLine.netAmount.toString()).eq(recalculated.netAmount)
          )
            throw issue(
              "invalid-reference",
              "The saved return credit does not reconcile to the original invoice terms.",
            );
          return recalculated.netAmount;
        }),
      );
      if (credit.gt(0))
        await tx.customerLedgerEntry.create({
          data: {
            customerId: salesReturn.customerId,
            entryType: "SALES_RETURN_CREDIT",
            entryDate: salesReturn.returnAt,
            signedAmount: credit.negated().toFixed(),
            salesReturnId: salesReturn.id,
            referenceType: "SALES_RETURN",
            referenceId: salesReturn.id,
            description: `Sales return ${salesReturn.number} customer receivable credit.`,
            createdByUserId: actorUserId,
          },
        });
      await tx.salesReturn.update({
        where: { id },
        data: { status: "COMPLETED", completedByUserId: actorUserId, completedAt: new Date() },
      });
      await postSalesReturnAccounting(tx, salesReturn.id, actorUserId);
      await recordAuditEvent(tx, {
        actorUserId,
        action: "COMPLETE",
        entityType: "SALES_RETURN",
        entityId: salesReturn.id,
        entityReference: salesReturn.number,
        module: "sales",
        description: `Financially completed sales return ${salesReturn.number}.`,
        metadata: { creditAmount: credit.toFixed() },
        beforeSnapshot: { status: salesReturn.status },
        afterSnapshot: { status: "COMPLETED" },
        related: {
          entityType: "SALES_INVOICE",
          entityId: salesReturn.salesInvoice.id,
          reference: salesReturn.salesInvoice.number,
        },
        controlEvent: true,
      });
    });
  }

  async cancelSalesReturn(id: string, reason: string, actorUserId: string) {
    await serializable(async (tx) => {
      const salesReturn = await tx.salesReturn.findUnique({
        where: { id },
        select: { status: true, number: true },
      });
      if (!salesReturn) throw issue("not-found", "Sales return no longer exists.");
      if (salesReturn.status !== "DRAFT")
        throw issue("invalid-state", "Only an unused draft sales return can be cancelled.");
      await tx.salesReturn.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledByUserId: actorUserId,
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
      });
      await recordAuditEvent(tx, {
        actorUserId,
        action: "CANCEL",
        entityType: "SALES_RETURN",
        entityId: id,
        entityReference: salesReturn.number,
        module: "sales",
        description: `Cancelled draft sales return ${salesReturn.number}.`,
        reasonCode: "OTHER",
        reason,
        beforeSnapshot: { status: salesReturn.status },
        afterSnapshot: { status: "CANCELLED" },
        controlEvent: true,
      });
    });
  }
}

async function saveReturn(tx: Prisma.TransactionClient, input: SalesReturnInput & { id?: string }) {
  const returnAt = parseDate(input.returnDate);
  const source =
    input.type === "INVOICED_RETURN"
      ? await invoicedSource(tx, input.salesInvoiceId!, input.salesDispatchId)
      : await refusalSource(tx, input.salesDispatchId);
  if (!source)
    throw issue("invalid-reference", "Select a posted source invoice or uninvoiced dispatch.");
  const warehouse = await tx.warehouse.findFirst({
    where: { id: input.receivingWarehouseId, active: true },
  });
  if (!warehouse) throw issue("invalid-reference", "Select an active receiving warehouse.");
  const seen = new Set<string>();
  const invoiceLineIds = input.lines.flatMap((line) =>
    line.salesInvoiceLineId ? [line.salesInvoiceLineId] : [],
  );
  const invoiceLines =
    input.type === "INVOICED_RETURN"
      ? await tx.salesInvoiceLine.findMany({
          where: { id: { in: invoiceLineIds }, salesInvoiceId: input.salesInvoiceId! },
          include: { item: { include: { finishedGoodProfile: true } } },
        })
      : [];
  const lines = input.lines.map((entry, index) => {
    const key = `${entry.salesInvoiceLineId ?? "refusal"}:${entry.salesDispatchAllocationId}`;
    if (seen.has(key))
      throw issue("invalid-reference", "A source lot can appear only once on a sales return.");
    seen.add(key);
    const sourceLine = source.lines.find(
      (line) =>
        line.salesInvoiceLineId === (entry.salesInvoiceLineId ?? null) &&
        line.salesDispatchLineId === entry.salesDispatchLineId &&
        line.salesDispatchAllocationId === entry.salesDispatchAllocationId,
    );
    if (!sourceLine)
      throw issue(
        "invalid-reference",
        `Return line ${index + 1} does not belong to the selected source.`,
      );
    const breakdown = carton(
      entry.cartons,
      entry.loosePieces,
      sourceLine.piecesPerCarton,
      index + 1,
    );
    if (new Decimal(breakdown.totalPieces).gt(sourceLine.returnablePieces))
      throw issue("stock", `Return line ${index + 1} exceeds its remaining returnable quantity.`);
    if (input.type === "DISPATCH_REFUSAL")
      return {
        salesDispatchLineId: sourceLine.salesDispatchLineId,
        salesDispatchAllocationId: sourceLine.salesDispatchAllocationId,
        productionLotId: sourceLine.salesDispatchAllocationId
          ? sourceLineFromSource(sourceLine).productionLotId
          : "",
        itemId: sourceLineFromSource(sourceLine).itemId,
        canonicalUnitId: sourceLineFromSource(sourceLine).canonicalUnitId,
        cartons: Number(breakdown.cartons),
        loosePieces: Number(breakdown.loosePieces),
        totalPieces: breakdown.totalPieces,
        reason: entry.reason,
        notes: entry.notes ?? null,
      };
    const invoiceLine = invoiceLines.find((line) => line.id === entry.salesInvoiceLineId);
    if (!invoiceLine?.item.finishedGoodProfile)
      throw issue("invalid-reference", "The invoice source is no longer a finished-good line.");
    const commercial = calculateSalesOrderLine({
      cartons: breakdown.cartons,
      loosePieces: breakdown.loosePieces,
      piecesPerCarton: invoiceLine.item.finishedGoodProfile.piecesPerCarton,
      cartonRate: invoiceLine.cartonRate.toString(),
      discount1Percent: invoiceLine.discount1Percent.toString(),
      discount2Percent: invoiceLine.discount2Percent.toString(),
      taxPercent: invoiceLine.taxPercent.toString(),
    });
    const sourceData = sourceLineFromSource(sourceLine);
    return {
      salesInvoiceLineId: invoiceLine.id,
      salesDispatchLineId: sourceLine.salesDispatchLineId,
      salesDispatchAllocationId: sourceLine.salesDispatchAllocationId,
      productionLotId: sourceData.productionLotId,
      itemId: invoiceLine.itemId,
      canonicalUnitId: invoiceLine.canonicalUnitId,
      cartons: Number(commercial.cartons),
      loosePieces: Number(commercial.loosePieces),
      totalPieces: commercial.totalPieces,
      reason: entry.reason,
      notes: entry.notes ?? null,
      cartonRate: invoiceLine.cartonRate,
      pieceRate: commercial.pieceRate,
      discount1Percent: invoiceLine.discount1Percent,
      discount2Percent: invoiceLine.discount2Percent,
      taxPercent: invoiceLine.taxPercent,
      grossAmount: commercial.grossAmount,
      discountAmount: commercial.discountAmount,
      taxAmount: commercial.taxAmount,
      netAmount: commercial.netAmount,
    };
  });
  const header = {
    type: input.type,
    customerId: source.customerId,
    salesInvoiceId: input.type === "INVOICED_RETURN" ? (input.salesInvoiceId ?? null) : null,
    salesOrderId: source.salesOrderId,
    salesDispatchId: source.salesDispatchId,
    receivingWarehouseId: warehouse.id,
    returnAt,
    customerReference: input.customerReference ?? null,
    notes: input.notes ?? null,
  };
  if (input.id) {
    await tx.salesReturnLine.deleteMany({ where: { salesReturnId: input.id } });
    await tx.salesReturn.update({
      where: { id: input.id },
      data: { ...header, lines: { create: lines } },
    });
    return input.id;
  }
  const sequence = await tx.salesReturnSequence.upsert({
    where: { year: returnAt.getUTCFullYear() },
    create: { year: returnAt.getUTCFullYear(), nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return (
    await tx.salesReturn.create({
      data: {
        number: `SR-${returnAt.getUTCFullYear()}-${String(sequence.nextValue - 1).padStart(6, "0")}`,
        ...header,
        createdByUserId: input.actorUserId,
        lines: { create: lines },
      },
    })
  ).id;
}

async function invoicedSource(
  client: Prisma.TransactionClient | typeof prisma,
  invoiceId: string,
  dispatchId?: string,
): Promise<SalesReturnSource | null> {
  const invoice = await client.salesInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: true,
      salesOrder: true,
      lines: {
        include: {
          salesDispatch: true,
          item: { include: { finishedGoodProfile: true } },
          allocations: {
            include: { salesDispatchAllocation: { include: { productionLot: true } } },
          },
        },
      },
    },
  });
  if (!invoice || invoice.status !== "POSTED") return null;
  const dispatches = [...new Set(invoice.lines.map((line) => line.salesDispatchId))];
  const selectedDispatch = dispatchId ?? (dispatches.length === 1 ? dispatches[0] : undefined);
  if (!selectedDispatch) return null;
  const returns = await client.salesReturnLine.groupBy({
    by: ["salesInvoiceLineId", "salesDispatchAllocationId"],
    where: {
      salesInvoiceLineId: { not: null },
      salesReturn: { status: { in: [...liveReturnStatuses] } },
    },
    _sum: { totalPieces: true },
  });
  const lines = invoice.lines
    .filter((line) => line.salesDispatchId === selectedDispatch)
    .flatMap((line) =>
      line.allocations.map((allocation) => {
        const returned =
          returns.find(
            (entry) =>
              entry.salesInvoiceLineId === line.id &&
              entry.salesDispatchAllocationId === allocation.salesDispatchAllocationId,
          )?._sum.totalPieces ?? new Decimal(0);
        const quantity = new Decimal(allocation.quantity.toString());
        const source = allocation.salesDispatchAllocation;
        return {
          salesInvoiceLineId: line.id,
          salesDispatchLineId: line.salesDispatchLineId,
          salesDispatchAllocationId: source.id,
          itemCode: line.item.code,
          itemName: line.item.name,
          lotNumber: allocation.salesDispatchAllocation.productionLot.lotNumber,
          expiryDate: allocation.salesDispatchAllocation.productionLot.expiryDate,
          piecesPerCarton: line.item.finishedGoodProfile?.piecesPerCarton ?? 0,
          dispatchedPieces: source.quantity.toString(),
          invoicedPieces: quantity.toFixed(),
          returnedPieces: returned.toString(),
          returnablePieces: Decimal.max(0, quantity.sub(returned.toString())).toFixed(),
          cartons: "0",
          loosePieces: "0",
          _source: {
            productionLotId: allocation.productionLotId,
            itemId: line.itemId,
            canonicalUnitId: line.canonicalUnitId,
          },
        };
      }),
    );
  const dispatch = invoice.lines.find(
    (line) => line.salesDispatchId === selectedDispatch,
  )?.salesDispatch;
  if (!dispatch) return null;
  return {
    type: "INVOICED_RETURN",
    sourceId: invoice.id,
    sourceNumber: invoice.number,
    customerId: invoice.customerId,
    customerName: invoice.customer.name,
    salesOrderId: invoice.salesOrderId,
    salesOrderNumber: invoice.salesOrder.number,
    salesDispatchId: dispatch.id,
    warehouseId: dispatch.sourceWarehouseId,
    warehouseName: "Source dispatch warehouse",
    lines,
  } as SalesReturnSource;
}

async function refusalSource(
  client: Prisma.TransactionClient | typeof prisma,
  dispatchId: string,
): Promise<SalesReturnSource | null> {
  const dispatch = await client.salesDispatch.findUnique({
    where: { id: dispatchId },
    include: {
      customer: true,
      salesOrder: true,
      sourceWarehouse: true,
      lines: {
        include: {
          item: { include: { finishedGoodProfile: true } },
          salesOrderLine: true,
          allocations: {
            include: {
              productionLot: true,
              invoiceAllocations: {
                where: { salesInvoiceLine: { salesInvoice: { status: "POSTED" } } },
              },
            },
          },
        },
      },
    },
  });
  if (!dispatch || !["POSTED", "DELIVERED"].includes(dispatch.status)) return null;
  const returns = await client.salesReturnLine.groupBy({
    by: ["salesDispatchAllocationId"],
    where: { salesInvoiceLineId: null, salesReturn: { status: { in: [...liveReturnStatuses] } } },
    _sum: { totalPieces: true },
  });
  const lines = dispatch.lines.flatMap((line) =>
    line.allocations.map((allocation) => {
      const invoiced = sum(allocation.invoiceAllocations.map((entry) => entry.quantity));
      const refused =
        returns.find((entry) => entry.salesDispatchAllocationId === allocation.id)?._sum
          .totalPieces ?? new Decimal(0);
      const quantity = new Decimal(allocation.quantity.toString());
      return {
        salesInvoiceLineId: null,
        salesDispatchLineId: line.id,
        salesDispatchAllocationId: allocation.id,
        itemCode: line.item.code,
        itemName: line.item.name,
        lotNumber: allocation.productionLot.lotNumber,
        expiryDate: allocation.productionLot.expiryDate,
        piecesPerCarton: line.item.finishedGoodProfile?.piecesPerCarton ?? 0,
        dispatchedPieces: quantity.toFixed(),
        invoicedPieces: invoiced.toFixed(),
        returnedPieces: refused.toString(),
        returnablePieces: Decimal.max(0, quantity.sub(invoiced).sub(refused.toString())).toFixed(),
        cartons: "0",
        loosePieces: "0",
        _source: {
          productionLotId: allocation.productionLotId,
          itemId: line.itemId,
          canonicalUnitId: line.salesOrderLine.canonicalUnitId,
        },
      };
    }),
  );
  return {
    type: "DISPATCH_REFUSAL",
    sourceId: dispatch.id,
    sourceNumber: dispatch.number,
    customerId: dispatch.customerId,
    customerName: dispatch.customer.name,
    salesOrderId: dispatch.salesOrderId,
    salesOrderNumber: dispatch.salesOrder.number,
    salesDispatchId: dispatch.id,
    warehouseId: dispatch.sourceWarehouseId,
    warehouseName: dispatch.sourceWarehouse.name,
    lines,
  } as SalesReturnSource;
}

function sourceLineFromSource(line: SalesReturnSource["lines"][number]) {
  const extended = line as typeof line & {
    _source?: { productionLotId: string; itemId: string; canonicalUnitId: string };
  };
  if (!extended._source)
    throw issue("invalid-reference", "Return source lot provenance is missing.");
  return extended._source;
}
function validateSavedLines(salesReturn: ReturnRow, source: SalesReturnSource) {
  for (const line of salesReturn.lines) {
    const current = source.lines.find(
      (candidate) =>
        candidate.salesInvoiceLineId === line.salesInvoiceLineId &&
        candidate.salesDispatchLineId === line.salesDispatchLineId &&
        candidate.salesDispatchAllocationId === line.salesDispatchAllocationId,
    );
    if (!current || new Decimal(line.totalPieces.toString()).gt(current.returnablePieces))
      throw issue(
        "stock",
        "A return line exceeds the remaining quantity from its original source.",
      );
  }
}
function prepareInspections(salesReturn: ReturnRow, input: readonly ReturnInspectionInput[]) {
  const grouped = new Map<string, ReturnInspectionInput[]>();
  for (const entry of input) {
    const line = salesReturn.lines.find((candidate) => candidate.id === entry.salesReturnLineId);
    if (!line) throw issue("invalid-reference", "Inspection contains a line outside this return.");
    const quantity = exactPositive(entry.quantity, "Inspection quantity");
    if (entry.classification === "DAMAGED" && !entry.reason?.trim())
      throw issue("invalid-reference", "Damaged returns require an inspection reason.");
    const list = grouped.get(entry.salesReturnLineId) ?? [];
    if (list.some((candidate) => candidate.classification === entry.classification))
      throw issue("invalid-reference", "A classification can appear only once per return line.");
    grouped.set(entry.salesReturnLineId, [...list, { ...entry, quantity }]);
  }
  if (grouped.size !== salesReturn.lines.length)
    throw issue(
      "invalid-reference",
      "Every returned line requires a full inspection classification.",
    );
  for (const line of salesReturn.lines) {
    if (
      !inspectionClassificationsReconcile(
        line.totalPieces.toString(),
        (grouped.get(line.id) ?? []).map((entry) => entry.quantity),
      )
    )
      throw issue(
        "invalid-reference",
        "Inspection classifications must exactly reconcile to each returned quantity.",
      );
  }
  return [...grouped.values()].flat();
}
function carton(cartons: string, loose: string, piecesPerCarton: number, position: number) {
  try {
    const value = normalizeCartonQuantity(cartons, loose, piecesPerCarton);
    if (new Decimal(value.totalPieces).lte(0))
      throw new Error("Quantity must be greater than zero.");
    return value;
  } catch (error) {
    throw issue(
      "invalid-reference",
      `Return line ${position}: ${error instanceof Error ? error.message : "quantity is invalid."}`,
    );
  }
}
function mapReturn(row: ReturnRow): SalesReturnRecord {
  const lines = row.lines.map((line) => ({
    id: line.id,
    salesInvoiceLineId: line.salesInvoiceLineId,
    salesDispatchLineId: line.salesDispatchLineId,
    salesDispatchAllocationId: line.salesDispatchAllocationId,
    itemCode: line.item.code,
    itemName: line.item.name,
    lotNumber: line.productionLot.lotNumber,
    expiryDate: line.productionLot.expiryDate,
    piecesPerCarton: line.item.finishedGoodProfile?.piecesPerCarton ?? 0,
    cartons: line.cartons.toString(),
    loosePieces: line.loosePieces.toString(),
    totalPieces: line.totalPieces.toString(),
    reason: line.reason,
    notes: line.notes,
    grossAmount: line.grossAmount?.toString() ?? null,
    discountAmount: line.discountAmount?.toString() ?? null,
    taxAmount: line.taxAmount?.toString() ?? null,
    netAmount: line.netAmount?.toString() ?? null,
    inspections: line.inspections.map((inspection) => ({
      id: inspection.id,
      classification: inspection.classification,
      quantity: inspection.quantity.toString(),
      reason: inspection.reason,
      notes: inspection.notes,
      createdByName: inspection.createdBy.name,
    })),
  }));
  const gross = sum(row.lines.map((line) => line.grossAmount));
  const discount = sum(row.lines.map((line) => line.discountAmount));
  const tax = sum(row.lines.map((line) => line.taxAmount));
  const credit = sum(row.lines.map((line) => line.netAmount));
  return {
    id: row.id,
    number: row.number,
    type: row.type,
    status: row.status,
    customerId: row.customerId,
    customerName: row.customer.name,
    customerCode: row.customer.code,
    salesInvoiceId: row.salesInvoiceId,
    salesInvoiceNumber: row.salesInvoice?.number ?? null,
    salesOrderNumber: row.salesOrder.number,
    salesDispatchNumber: row.salesDispatch.number,
    receivingWarehouseName: row.receivingWarehouse.name,
    returnAt: row.returnAt,
    customerReference: row.customerReference,
    notes: row.notes,
    grossAmount: gross.toFixed(),
    discountAmount: discount.toFixed(),
    taxAmount: tax.toFixed(),
    creditAmount: credit.toFixed(),
    createdByName: row.createdBy.name,
    receivedByName: row.receivedBy?.name ?? null,
    receivedAt: row.receivedAt,
    inspectedByName: row.inspectedBy?.name ?? null,
    inspectedAt: row.inspectedAt,
    completedByName: row.completedBy?.name ?? null,
    completedAt: row.completedAt,
    cancelledByName: row.cancelledBy?.name ?? null,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    lines,
  };
}
function sum(values: readonly ({ toString(): string } | null | undefined)[]) {
  return values.reduce<Decimal>(
    (total, value) => (value === null || value === undefined ? total : total.add(value.toString())),
    new Decimal(0),
  );
}
function exactPositive(value: string, label: string) {
  try {
    const amount = new Decimal(value);
    if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 6) throw new Error();
    return amount.toFixed();
  } catch {
    throw issue("invalid-reference", `${label} must be a positive exact quantity.`);
  }
}
function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw issue("invalid-reference", "Return date is invalid.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
    throw issue("invalid-reference", "Return date is invalid.");
  return date;
}
function issue(
  reason: ConstructorParameters<typeof SalesReturnRepositoryError>[0],
  message: string,
) {
  return new SalesReturnRepositoryError(reason, message);
}
async function serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1)
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (caught) {
      if (
        caught instanceof Prisma.PrismaClientKnownRequestError &&
        caught.code === "P2034" &&
        attempt < 3
      )
        continue;
      if (caught instanceof InventoryRepositoryError)
        throw issue(caught.reason === "stock" ? "stock" : "invalid-reference", caught.message);
      if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002")
        throw issue(
          "conflict",
          "A sales-return number, ledger credit, or inventory event already exists.",
        );
      if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2025")
        throw issue("not-found", "Sales return no longer exists.");
      throw caught;
    }
  throw issue("conflict", "Sales return transaction conflict; retry.");
}
