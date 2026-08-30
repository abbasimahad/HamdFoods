import "server-only";

import Decimal from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import { InventoryRepositoryError } from "@/modules/inventory/application/contracts";
import { SalesInvoiceRepositoryError } from "@/modules/sales/application/sales-invoice-contracts";
import type {
  SalesInvoiceInput,
  SalesInvoiceListReferences,
  SalesInvoicePage,
  SalesInvoiceQuery,
  SalesInvoiceRecord,
  SalesInvoiceReferences,
  SalesInvoiceRepository,
} from "@/modules/sales/application/sales-invoice-contracts";
import {
  calculateSalesOrderLine,
  calculateSalesOrderTotals,
  SALES_ORDER_PAGE_SIZE,
} from "@/modules/sales/domain/sales-orders";
import { normalizeCartonQuantity } from "@/modules/quantity/domain/cartons";
import { prisma } from "@/server/db/prisma";
import { postSalesInvoiceOutflowInventory } from "@/server/inventory/transactional-inventory-posting";
import { valueSalesInvoiceOutflow } from "@/server/costing/prisma-inventory-valuation-repository";
import { postSalesInvoiceAccounting } from "@/server/accounting/transactional-accounting-posting";
import { effectiveCustomerPaymentWhere } from "@/server/accounting/payment-effectiveness";
import { recordAuditEvent } from "@/server/audit/audit-event";
import { assertCreditAvailable, CreditExposureError } from "./credit-exposure";
import { customerInvoiceSettlement } from "./customer-invoice-settlement";

const postedInvoiceLines = {
  where: { salesInvoice: { status: "POSTED" as const } },
  include: { allocations: true },
};
const postedPaymentAllocations = { where: { customerPayment: effectiveCustomerPaymentWhere() } };
const completedReturns = {
  where: { status: "COMPLETED" as const },
  include: { ledgerEntry: true },
};
const invoiceInclude = {
  salesOrder: true,
  customer: true,
  createdBy: true,
  postedBy: true,
  cancelledBy: true,
  ledgerEntries: true,
  paymentAllocations: postedPaymentAllocations,
  salesReturns: completedReturns,
  lines: {
    include: {
      item: { include: { finishedGoodProfile: true } },
      salesDispatch: true,
      allocations: { include: { productionLot: true } },
    },
  },
} satisfies Prisma.SalesInvoiceInclude;
type InvoiceRow = Prisma.SalesInvoiceGetPayload<{ include: typeof invoiceInclude }>;

export class PrismaSalesInvoiceRepository implements SalesInvoiceRepository {
  async getSalesInvoiceReferences(): Promise<SalesInvoiceReferences> {
    const orders = await prisma.salesOrder.findMany({
      where: { status: { in: ["PARTIALLY_DISPATCHED", "DISPATCHED"] } },
      include: { customer: true },
      orderBy: { number: "desc" },
      take: 1000,
    });
    return {
      orders: orders.map((order) => ({
        id: order.id,
        number: order.number,
        customerName: order.customer.name,
        status: order.status as "PARTIALLY_DISPATCHED" | "DISPATCHED",
      })),
    };
  }

  async getSalesInvoiceListReferences(): Promise<SalesInvoiceListReferences> {
    const invoices = await prisma.salesInvoice.findMany({
      select: {
        customer: { select: { id: true, code: true, name: true } },
        salesOrder: { select: { id: true, number: true } },
      },
      take: 1000,
      orderBy: { invoiceDate: "desc" },
    });
    return {
      customers: [
        ...new Map(invoices.map((invoice) => [invoice.customer.id, invoice.customer])).values(),
      ],
      orders: [
        ...new Map(invoices.map((invoice) => [invoice.salesOrder.id, invoice.salesOrder])).values(),
      ],
    };
  }

  async getInvoiceSourceOrder(id: string) {
    const order = await prisma.salesOrder.findUnique({
      where: { id },
      include: {
        customer: true,
        dispatches: {
          where: { status: { in: ["POSTED", "DELIVERED"] } },
          include: {
            lines: {
              include: {
                item: { include: { finishedGoodProfile: true } },
                allocations: {
                  include: {
                    productionLot: true,
                    invoiceAllocations: {
                      where: { salesInvoiceLine: { salesInvoice: { status: "POSTED" } } },
                    },
                    salesReturnLines: {
                      where: {
                        salesInvoiceLineId: null,
                        salesReturn: { status: { in: ["RECEIVED", "INSPECTED", "COMPLETED"] } },
                      },
                    },
                  },
                },
                invoiceLines: postedInvoiceLines,
              },
            },
          },
        },
      },
    });
    if (!order || !["PARTIALLY_DISPATCHED", "DISPATCHED"].includes(order.status)) return null;
    return {
      id: order.id,
      number: order.number,
      customerName: order.customer.name,
      customerCode: order.customer.code,
      billingAddress: address(order.customer),
      deliveryAddress: address(order.customer),
      paymentTermsDays: order.paymentTermsDays,
      lines: order.dispatches.flatMap((dispatch) =>
        dispatch.lines.map((line) => {
          const invoiced = sum(line.invoiceLines.map((invoiceLine) => invoiceLine.totalPieces));
          const invoiceablePieces = sum(
            line.allocations.map((allocation) => {
              const invoicedFromLot = sum(
                allocation.invoiceAllocations.map((entry) => entry.quantity),
              );
              const refusedFromLot = sum(
                allocation.salesReturnLines.map((salesReturn) => salesReturn.totalPieces),
              );
              return nonNegative(
                new Decimal(allocation.quantity.toString())
                  .sub(invoicedFromLot)
                  .sub(refusedFromLot),
              );
            }),
          );
          return {
            id: line.id,
            dispatchId: dispatch.id,
            dispatchNumber: dispatch.number,
            dispatchDate: dispatch.dispatchAt,
            salesOrderLineId: line.salesOrderLineId,
            itemCode: line.item.code,
            itemName: line.item.name,
            piecesPerCarton: line.item.finishedGoodProfile?.piecesPerCarton ?? 0,
            dispatchedPieces: line.totalPieces.toString(),
            invoicedPieces: invoiced.toFixed(),
            invoiceablePieces: invoiceablePieces.toFixed(),
            allocations: line.allocations.map((allocation) => {
              const allocationInvoiced = sum(
                allocation.invoiceAllocations.map((entry) => entry.quantity),
              );
              const refused = sum(
                allocation.salesReturnLines.map((salesReturn) => salesReturn.totalPieces),
              );
              return {
                id: allocation.id,
                lotNumber: allocation.productionLot.lotNumber,
                quantity: allocation.quantity.toString(),
                invoicedPieces: allocationInvoiced.toFixed(),
                invoiceablePieces: nonNegative(
                  new Decimal(allocation.quantity.toString()).sub(allocationInvoiced).sub(refused),
                ).toFixed(),
              };
            }),
          };
        }),
      ),
    };
  }

  async createSalesInvoice(input: SalesInvoiceInput) {
    return serializable((transaction) => saveInvoice(transaction, input));
  }
  async updateSalesInvoice(input: SalesInvoiceInput & { id: string }) {
    return serializable(async (transaction) => {
      const current = await transaction.salesInvoice.findUnique({
        where: { id: input.id },
        select: { status: true, salesOrderId: true },
      });
      if (!current) throw fail("not-found", "Invoice no longer exists.");
      if (current.status !== "DRAFT")
        throw fail("invalid-state", "Only draft invoices can be edited.");
      if (current.salesOrderId !== input.salesOrderId)
        throw fail("invalid-reference", "A draft invoice cannot be moved to another sales order.");
      return saveInvoice(transaction, input);
    });
  }
  async getSalesInvoice(id: string) {
    const invoice = await prisma.salesInvoice.findUnique({
      where: { id },
      include: invoiceInclude,
    });
    return invoice ? mapInvoice(invoice) : null;
  }

  async listSalesInvoices(
    query: SalesInvoiceQuery,
  ): Promise<SalesInvoicePage<Omit<SalesInvoiceRecord, "lines">>> {
    const where = {
      ...(query.query
        ? {
            OR: [
              { number: { contains: query.query, mode: "insensitive" as const } },
              { customer: { name: { contains: query.query, mode: "insensitive" as const } } },
              { salesOrder: { number: { contains: query.query, mode: "insensitive" as const } } },
            ],
          }
        : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.salesOrderId ? { salesOrderId: query.salesOrderId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            invoiceDate: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lte: query.dateTo } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await prisma.$transaction([
      prisma.salesInvoice.count({ where }),
      prisma.salesInvoice.findMany({
        where,
        include: invoiceInclude,
        orderBy: [{ invoiceDate: "desc" }, { number: "desc" }],
        skip: (query.page - 1) * SALES_ORDER_PAGE_SIZE,
        take: SALES_ORDER_PAGE_SIZE,
      }),
    ]);
    return {
      records: rows.map(mapInvoice),
      total,
      page: query.page,
      pageCount: Math.max(1, Math.ceil(total / SALES_ORDER_PAGE_SIZE)),
    };
  }

  async postSalesInvoice(id: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const invoice = await transaction.salesInvoice.findUnique({
        where: { id },
        include: {
          lines: {
            include: {
              allocations: {
                include: {
                  salesDispatchAllocation: {
                    include: { salesDispatchLine: { include: { salesDispatch: true } } },
                  },
                },
              },
            },
          },
        },
      });
      if (!invoice) throw fail("not-found", "Invoice no longer exists.");
      if (invoice.status !== "DRAFT")
        throw fail("invalid-state", "Only draft invoices can be posted.");
      if (!invoice.lines.length)
        throw fail("invalid-reference", "Invoice needs at least one line.");
      await assertCreditAvailable(
        transaction,
        invoice.customerId,
        invoice.grandTotal.toString(),
        invoice.salesOrderId,
      );
      for (const line of invoice.lines) {
        if (
          !sum(line.allocations.map((allocation) => allocation.quantity)).eq(
            line.totalPieces.toString(),
          )
        )
          throw fail(
            "invalid-reference",
            "Invoice lot allocations do not reconcile to their invoice line.",
          );
        for (const allocation of line.allocations) {
          const source = allocation.salesDispatchAllocation;
          if (
            !["POSTED", "DELIVERED"].includes(source.salesDispatchLine.salesDispatch.status) ||
            source.salesDispatchLine.salesDispatch.salesOrderId !== invoice.salesOrderId ||
            source.salesDispatchLine.salesOrderLineId !== line.salesOrderLineId ||
            source.salesDispatchLine.itemId !== line.itemId ||
            source.productionLotId !== allocation.productionLotId
          )
            throw fail(
              "invalid-reference",
              "Invoice source is not a matching posted dispatch allocation.",
            );
        }
      }
      await postSalesInvoiceOutflowInventory(
        transaction,
        invoice.lines.flatMap((line) =>
          line.allocations.map((allocation) => ({
            salesInvoiceId: invoice.id,
            salesInvoiceNumber: invoice.number,
            salesInvoiceLineId: line.id,
            salesInvoiceAllocationId: allocation.id,
            salesOrderId: invoice.salesOrderId,
            salesOrderLineId: line.salesOrderLineId,
            salesDispatchId: allocation.salesDispatchAllocation.salesDispatchLine.salesDispatchId,
            salesDispatchLineId: allocation.salesDispatchAllocation.salesDispatchLineId,
            salesDispatchAllocationId: allocation.salesDispatchAllocationId,
            itemId: line.itemId,
            warehouseId:
              allocation.salesDispatchAllocation.salesDispatchLine.salesDispatch.sourceWarehouseId,
            canonicalUnitId: line.canonicalUnitId,
            productionLotId: allocation.productionLotId,
            quantity: allocation.quantity.toString(),
            actorUserId,
          })),
        ),
      );
      await valueSalesInvoiceOutflow(transaction, invoice.id, actorUserId);
      await transaction.customerLedgerEntry.create({
        data: {
          customerId: invoice.customerId,
          entryType: "SALES_INVOICE",
          entryDate: invoice.invoiceDate,
          dueDate: invoice.dueDate,
          signedAmount: invoice.grandTotal,
          salesInvoiceId: invoice.id,
          referenceType: "SALES_INVOICE",
          referenceId: invoice.id,
          description: `Sales invoice ${invoice.number} receivable.`,
          createdByUserId: actorUserId,
        },
      });
      await transaction.salesInvoice.update({
        where: { id },
        data: { status: "POSTED", postedByUserId: actorUserId, postedAt: new Date() },
      });
      await postSalesInvoiceAccounting(transaction, invoice.id, actorUserId);
      await closeSalesOrderWhenComplete(transaction, invoice.salesOrderId);
      await recordAuditEvent(transaction, {
        actorUserId,
        action: "POST",
        entityType: "SALES_INVOICE",
        entityId: invoice.id,
        entityReference: invoice.number,
        module: "sales",
        description: `Posted sales invoice ${invoice.number}.`,
        metadata: { grandTotal: invoice.grandTotal.toString(), lineCount: invoice.lines.length },
        beforeSnapshot: { status: invoice.status },
        afterSnapshot: { status: "POSTED" },
        related: { entityType: "SALES_ORDER", entityId: invoice.salesOrderId },
        controlEvent: true,
      });
    });
  }

  async cancelSalesInvoice(id: string, reason: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const invoice = await transaction.salesInvoice.findUnique({
        where: { id },
        select: { status: true, number: true },
      });
      if (!invoice) throw fail("not-found", "Invoice no longer exists.");
      if (invoice.status !== "DRAFT")
        throw fail("invalid-state", "Only draft invoices can be cancelled.");
      await transaction.salesInvoice.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledByUserId: actorUserId,
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
      });
      await recordAuditEvent(transaction, {
        actorUserId,
        action: "CANCEL",
        entityType: "SALES_INVOICE",
        entityId: id,
        entityReference: invoice.number,
        module: "sales",
        description: `Cancelled draft sales invoice ${invoice.number}.`,
        reasonCode: "OTHER",
        reason,
        controlEvent: true,
      });
    });
  }
}

async function saveInvoice(
  transaction: Prisma.TransactionClient,
  input: SalesInvoiceInput & { id?: string },
) {
  const order = await transaction.salesOrder.findUnique({
    where: { id: input.salesOrderId },
    include: {
      customer: true,
      lines: { include: { item: { include: { finishedGoodProfile: true } } } },
      dispatches: {
        where: { status: { in: ["POSTED", "DELIVERED"] } },
        include: {
          lines: {
            include: {
              allocations: {
                include: {
                  invoiceAllocations: {
                    where: { salesInvoiceLine: { salesInvoice: { status: "POSTED" } } },
                  },
                  salesReturnLines: {
                    where: {
                      salesInvoiceLineId: null,
                      salesReturn: { status: { in: ["RECEIVED", "INSPECTED", "COMPLETED"] } },
                    },
                  },
                },
              },
              invoiceLines: postedInvoiceLines,
            },
          },
        },
      },
    },
  });
  if (!order || !["PARTIALLY_DISPATCHED", "DISPATCHED"].includes(order.status))
    throw fail("invalid-reference", "Select a sales order with posted dispatches.");
  const invoiceDate = parseDate(input.invoiceDate);
  const seen = new Set<string>();
  const lines = input.lines.map((entry) => {
    if (seen.has(entry.salesDispatchLineId))
      throw fail("invalid-reference", "A dispatch line can appear only once on an invoice.");
    seen.add(entry.salesDispatchLineId);
    const dispatch = order.dispatches.find((candidate) =>
      candidate.lines.some((line) => line.id === entry.salesDispatchLineId),
    );
    const source = dispatch?.lines.find((line) => line.id === entry.salesDispatchLineId);
    const orderLine = source && order.lines.find((line) => line.id === source.salesOrderLineId);
    if (!dispatch || !source || !orderLine?.item.finishedGoodProfile)
      throw fail("invalid-reference", "Invoice line is not an eligible dispatch source.");
    const quantity = normalizeCartonQuantity(
      entry.cartons,
      entry.loosePieces,
      orderLine.item.finishedGoodProfile.piecesPerCarton,
    );
    const requested = new Decimal(quantity.totalPieces);
    const invoiceable = sum(
      source.allocations.map((allocation) => {
        const invoicedFromLot = sum(
          allocation.invoiceAllocations.map((invoice) => invoice.quantity),
        );
        const refusedFromLot = sum(
          allocation.salesReturnLines.map((salesReturn) => salesReturn.totalPieces),
        );
        return nonNegative(
          new Decimal(allocation.quantity.toString()).sub(invoicedFromLot).sub(refusedFromLot),
        );
      }),
    );
    if (requested.lte(0) || requested.gt(invoiceable))
      throw fail(
        "stock",
        `Invoice quantity exceeds the ${invoiceable.toFixed()} invoiceable pieces on dispatch ${dispatch.number}.`,
      );
    const commercial = calculateSalesOrderLine({
      cartons: quantity.cartons,
      loosePieces: quantity.loosePieces,
      piecesPerCarton: orderLine.item.finishedGoodProfile.piecesPerCarton,
      cartonRate: orderLine.cartonRate.toString(),
      discount1Percent: orderLine.discount1Percent.toString(),
      discount2Percent: orderLine.discount2Percent.toString(),
      taxPercent: orderLine.taxPercent.toString(),
    });
    let unallocated = requested;
    const allocations = source.allocations.flatMap((allocation) => {
      const invoicedFromLot = sum(allocation.invoiceAllocations.map((entry) => entry.quantity));
      const refusedFromLot = sum(
        allocation.salesReturnLines.map((salesReturn) => salesReturn.totalPieces),
      );
      const invoiceableFromLot = nonNegative(
        new Decimal(allocation.quantity.toString()).sub(invoicedFromLot).sub(refusedFromLot),
      );
      const take = Decimal.min(unallocated, invoiceableFromLot);
      if (take.lte(0)) return [];
      unallocated = unallocated.sub(take);
      return [
        {
          salesDispatchAllocationId: allocation.id,
          productionLotId: allocation.productionLotId,
          quantity: take.toFixed(),
        },
      ];
    });
    if (unallocated.gt(0))
      throw fail("stock", "Dispatch lot allocations no longer contain enough invoiceable stock.");
    return {
      salesOrderLineId: orderLine.id,
      salesDispatchId: dispatch.id,
      salesDispatchLineId: source.id,
      itemId: source.itemId,
      cartons: Number(commercial.cartons),
      loosePieces: Number(commercial.loosePieces),
      totalPieces: commercial.totalPieces,
      canonicalUnitId: orderLine.canonicalUnitId,
      cartonRate: orderLine.cartonRate,
      pieceRate: commercial.pieceRate,
      discount1Percent: orderLine.discount1Percent,
      discount2Percent: orderLine.discount2Percent,
      taxPercent: orderLine.taxPercent,
      grossAmount: commercial.grossAmount,
      discountAmount: commercial.discountAmount,
      taxAmount: commercial.taxAmount,
      netAmount: commercial.netAmount,
      notes: entry.notes ?? null,
      allocations: { create: allocations },
    };
  });
  const totals = calculateSalesOrderTotals(lines);
  const dueDate = new Date(invoiceDate);
  dueDate.setUTCDate(dueDate.getUTCDate() + (order.paymentTermsDays ?? 0));
  const header = {
    salesOrderId: order.id,
    customerId: order.customerId,
    invoiceDate,
    dueDate,
    paymentTermsDays: order.paymentTermsDays,
    salespersonName: order.salespersonName,
    areaName: order.areaName,
    routeName: order.routeName,
    billingAddress: address(order.customer),
    deliveryAddress: address(order.customer),
    notes: input.notes ?? null,
    ...totals,
  };
  if (input.id) {
    await transaction.salesInvoiceLine.deleteMany({ where: { salesInvoiceId: input.id } });
    await transaction.salesInvoice.update({
      where: { id: input.id },
      data: { ...header, lines: { create: lines } },
    });
    return input.id;
  }
  const sequence = await transaction.salesInvoiceSequence.upsert({
    where: { year: invoiceDate.getUTCFullYear() },
    create: { year: invoiceDate.getUTCFullYear(), nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return (
    await transaction.salesInvoice.create({
      data: {
        number: `INV-${invoiceDate.getUTCFullYear()}-${String(sequence.nextValue - 1).padStart(6, "0")}`,
        ...header,
        createdByUserId: input.actorUserId,
        lines: { create: lines },
      },
    })
  ).id;
}

async function closeSalesOrderWhenComplete(
  transaction: Prisma.TransactionClient,
  salesOrderId: string,
) {
  const [orderLines, dispatched, invoiced] = await Promise.all([
    transaction.salesOrderLine.findMany({ where: { salesOrderId } }),
    transaction.salesDispatchLine.groupBy({
      by: ["salesOrderLineId"],
      where: { salesDispatch: { salesOrderId, status: { in: ["POSTED", "DELIVERED"] } } },
      _sum: { totalPieces: true },
    }),
    transaction.salesInvoiceLine.groupBy({
      by: ["salesOrderLineId"],
      where: { salesInvoice: { salesOrderId, status: "POSTED" } },
      _sum: { totalPieces: true },
    }),
  ]);
  const dispatchedByLine = new Map(
    dispatched.map((line) => [
      line.salesOrderLineId,
      new Decimal(line._sum.totalPieces?.toString() ?? "0"),
    ]),
  );
  const invoicedByLine = new Map(
    invoiced.map((line) => [
      line.salesOrderLineId,
      new Decimal(line._sum.totalPieces?.toString() ?? "0"),
    ]),
  );
  if (
    orderLines.every(
      (line) =>
        dispatchedByLine.get(line.id)?.eq(line.totalPieces.toString()) &&
        invoicedByLine.get(line.id)?.eq(line.totalPieces.toString()),
    )
  )
    await transaction.salesOrder.update({
      where: { id: salesOrderId },
      data: { status: "CLOSED" },
    });
}

function mapInvoice(invoice: InvoiceRow): SalesInvoiceRecord {
  const settlement = customerInvoiceSettlement(invoice);
  return {
    id: invoice.id,
    number: invoice.number,
    salesOrderId: invoice.salesOrderId,
    salesOrderNumber: invoice.salesOrder.number,
    customerId: invoice.customerId,
    customerName: invoice.customer.name,
    customerCode: invoice.customer.code,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    paymentTermsDays: invoice.paymentTermsDays,
    salespersonName: invoice.salespersonName,
    areaName: invoice.areaName,
    routeName: invoice.routeName,
    billingAddress: invoice.billingAddress,
    deliveryAddress: invoice.deliveryAddress,
    status: invoice.status,
    notes: invoice.notes,
    subtotal: invoice.subtotal.toString(),
    discountTotal: invoice.discountTotal.toString(),
    taxTotal: invoice.taxTotal.toString(),
    grandTotal: invoice.grandTotal.toString(),
    outstandingAmount: settlement.presentationOutstanding.toFixed(),
    createdByName: invoice.createdBy.name,
    postedByName: invoice.postedBy?.name ?? null,
    postedAt: invoice.postedAt,
    cancelledByName: invoice.cancelledBy?.name ?? null,
    cancelledAt: invoice.cancelledAt,
    cancellationReason: invoice.cancellationReason,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      salesOrderLineId: line.salesOrderLineId,
      salesDispatchLineId: line.salesDispatchLineId,
      dispatchId: line.salesDispatchId,
      dispatchNumber: line.salesDispatch.number,
      itemCode: line.item.code,
      itemName: line.item.name,
      piecesPerCarton: line.item.finishedGoodProfile?.piecesPerCarton ?? 0,
      cartons: line.cartons.toString(),
      loosePieces: line.loosePieces.toString(),
      totalPieces: line.totalPieces.toString(),
      cartonRate: line.cartonRate.toString(),
      pieceRate: line.pieceRate.toString(),
      discount1Percent: line.discount1Percent.toString(),
      discount2Percent: line.discount2Percent.toString(),
      taxPercent: line.taxPercent.toString(),
      grossAmount: line.grossAmount.toString(),
      discountAmount: line.discountAmount.toString(),
      taxAmount: line.taxAmount.toString(),
      netAmount: line.netAmount.toString(),
      notes: line.notes,
      allocations: line.allocations.map((allocation) => ({
        lotNumber: allocation.productionLot.lotNumber,
        quantity: allocation.quantity.toString(),
      })),
    })),
  };
}
function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw fail("invalid-reference", "Invoice date is invalid.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
    throw fail("invalid-reference", "Invoice date is invalid.");
  return date;
}
function address(customer: { address: string | null; city: string | null }) {
  return [customer.address, customer.city].filter(Boolean).join(", ") || "Address not recorded";
}
function nonNegative(value: Decimal) {
  return Decimal.max(0, value);
}
function sum(values: readonly { toString(): string }[]): Decimal {
  return values.reduce<Decimal>((total, value) => total.add(value.toString()), new Decimal(0));
}
function fail(
  reason: ConstructorParameters<typeof SalesInvoiceRepositoryError>[0],
  message: string,
) {
  return new SalesInvoiceRepositoryError(reason, message);
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
      if (caught instanceof CreditExposureError) throw fail("credit", caught.message);
      if (caught instanceof InventoryRepositoryError)
        throw fail(caught.reason === "stock" ? "stock" : "invalid-reference", caught.message);
      if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002")
        throw fail("conflict", "An invoice number or ledger event already exists.");
      if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2025")
        throw fail("not-found", "Invoice no longer exists.");
      throw caught;
    }
  throw fail("conflict", "Invoice transaction conflict; retry.");
}
