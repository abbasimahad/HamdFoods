import "server-only";

import Decimal from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import { InventoryRepositoryError } from "@/modules/inventory/application/contracts";
import { isCanonicalPieceUnit } from "@/modules/quantity/domain/quantity";
import {
  calculateSalesOrderLine,
  calculateSalesOrderTotals,
  SALES_ORDER_PAGE_SIZE,
} from "@/modules/sales/domain/sales-orders";
import type {
  SalesOrderCatalogItem,
  SalesOrderInput,
  SalesOrderLineInput,
  SalesOrderPage,
  SalesOrderQuery,
  SalesOrderRecord,
  SalesOrderReferences,
  SalesOrderRepository,
} from "@/modules/sales/application/sales-order-contracts";
import { SalesOrderRepositoryError } from "@/modules/sales/application/sales-order-contracts";
import { postSalesOrderReservationInventory } from "@/server/inventory/transactional-inventory-posting";
import { assertCreditAvailable, CreditExposureError } from "@/server/sales/credit-exposure";
import { prisma } from "@/server/db/prisma";

const orderInclude = {
  customer: true,
  warehouse: true,
  createdBy: true,
  approvedBy: true,
  cancelledBy: true,
  lines: {
    include: { item: { include: { finishedGoodProfile: true } } },
    orderBy: { position: "asc" as const },
  },
} satisfies Prisma.SalesOrderInclude;
type OrderRow = Prisma.SalesOrderGetPayload<{ include: typeof orderInclude }>;
type FinishedGoodRow = Prisma.ItemGetPayload<{
  include: { stockUnit: true; finishedGoodProfile: true };
}>;

export class PrismaSalesOrderRepository implements SalesOrderRepository {
  async getSalesOrderReferences(): Promise<SalesOrderReferences> {
    const [customers, warehouses, items] = await Promise.all([
      prisma.customer.findMany({
        where: { active: true, area: { active: true } },
        include: { area: true, route: true, salesperson: true },
        orderBy: { name: "asc" },
        take: 1000,
      }),
      prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" }, take: 500 }),
      prisma.item.findMany({
        where: { active: true, itemType: "FINISHED_GOOD", stockUnit: { active: true } },
        include: { stockUnit: true, finishedGoodProfile: true },
        orderBy: { name: "asc" },
        take: 1000,
      }),
    ]);
    return {
      customers: customers.map((customer) => ({
        id: customer.id,
        code: customer.code,
        name: customer.name,
        salespersonId: customer.salesperson?.active ? customer.salespersonId : null,
        salespersonName: customer.salesperson?.active ? customer.salesperson.name : null,
        areaId: customer.areaId,
        areaName: customer.area.name,
        routeId: customer.route?.active ? customer.routeId : null,
        routeName: customer.route?.active ? customer.route.name : null,
        paymentTermsDays: customer.paymentTermsDays,
        creditLimit: customer.creditLimit?.toString() ?? null,
      })),
      warehouses: warehouses.map((warehouse) => ({
        id: warehouse.id,
        code: warehouse.code,
        name: warehouse.name,
      })),
      items: items.filter(validFinishedGood).map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        piecesPerCarton: item.finishedGoodProfile!.piecesPerCarton,
      })),
    };
  }

  async listSalesOrderItems(warehouseId: string): Promise<readonly SalesOrderCatalogItem[]> {
    const items = await prisma.item.findMany({
      where: { active: true, itemType: "FINISHED_GOOD", stockUnit: { active: true } },
      include: { stockUnit: true, finishedGoodProfile: true },
      orderBy: { name: "asc" },
      take: 1000,
    });
    const balances = await prisma.inventoryMovement.groupBy({
      by: ["itemId"],
      where: { warehouseId, status: "AVAILABLE", itemId: { in: items.map((item) => item.id) } },
      _sum: { quantity: true },
    });
    return items.filter(validFinishedGood).map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      piecesPerCarton: item.finishedGoodProfile!.piecesPerCarton,
      availablePieces:
        balances.find((balance) => balance.itemId === item.id)?._sum.quantity?.toString() ?? "0",
    }));
  }

  async createSalesOrder(input: SalesOrderInput) {
    return serializable(async (transaction) => {
      const prepared = await prepareOrder(transaction, input);
      const number = await nextNumber(transaction, prepared.header.orderDate.getUTCFullYear());
      return (
        await transaction.salesOrder.create({
          data: {
            number,
            ...prepared.header,
            ...prepared.totals,
            createdByUserId: input.actorUserId,
            lines: { create: prepared.lines.map((line, index) => createLineData(line, index + 1)) },
          },
        })
      ).id;
    });
  }

  async updateSalesOrder(input: SalesOrderInput & { id: string }) {
    return serializable(async (transaction) => {
      const current = await transaction.salesOrder.findUnique({
        where: { id: input.id },
        select: { status: true },
      });
      if (!current)
        throw new SalesOrderRepositoryError("not-found", "Sales order no longer exists.");
      if (current.status !== "DRAFT")
        throw new SalesOrderRepositoryError(
          "invalid-state",
          "Only draft sales orders can be edited.",
        );
      const prepared = await prepareOrder(transaction, input);
      await transaction.salesOrderLine.deleteMany({ where: { salesOrderId: input.id } });
      await transaction.salesOrder.update({
        where: { id: input.id },
        data: {
          ...prepared.header,
          ...prepared.totals,
          lines: { create: prepared.lines.map((line, index) => createLineData(line, index + 1)) },
        },
      });
      return input.id;
    });
  }

  async approveSalesOrder(id: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const order = await transaction.salesOrder.findUnique({
        where: { id },
        include: orderInclude,
      });
      if (!order) throw new SalesOrderRepositoryError("not-found", "Sales order no longer exists.");
      if (order.status !== "DRAFT")
        throw new SalesOrderRepositoryError(
          "invalid-state",
          "Only a draft sales order can be approved.",
        );
      const prepared = await prepareApproval(transaction, order);
      await assertCreditAvailable(transaction, order.customerId, prepared.totals.grandTotal);
      for (const [index, line] of prepared.lines.entries()) {
        await transaction.salesOrderLine.update({
          where: { salesOrderId_position: { salesOrderId: id, position: index + 1 } },
          data: line,
        });
      }
      await postSalesOrderReservationInventory(
        transaction,
        prepared.lines.map((line, index) => ({
          operation: "RESERVE" as const,
          salesOrderId: id,
          salesOrderNumber: order.number,
          salesOrderLineId: order.lines[index]!.id,
          itemId: line.itemId,
          warehouseId: order.warehouseId,
          canonicalUnitId: line.canonicalUnitId,
          quantity: line.totalPieces,
          actorUserId,
        })),
      );
      await transaction.salesOrder.update({
        where: { id },
        data: {
          ...prepared.totals,
          status: "APPROVED",
          approvedByUserId: actorUserId,
          approvedAt: new Date(),
        },
      });
    });
  }

  async reserveRedeliveryStock(id: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const order = await transaction.salesOrder.findUnique({
        where: { id },
        include: {
          warehouse: true,
          lines: { include: { item: { include: { stockUnit: true, finishedGoodProfile: true } } } },
        },
      });
      if (!order) throw new SalesOrderRepositoryError("not-found", "Sales order no longer exists.");
      if (order.status !== "PARTIALLY_DISPATCHED")
        throw new SalesOrderRepositoryError(
          "invalid-state",
          "Only a partially dispatched sales order can reserve stock for redelivery.",
        );
      if (!order.warehouse.active)
        throw new SalesOrderRepositoryError(
          "invalid-reference",
          "The sales-order warehouse is inactive.",
        );
      const quantities = await lineQuantities(
        transaction,
        order.lines.map((line) => line.id),
        order.warehouseId,
      );
      const commands = order.lines.flatMap((line) => {
        if (!line.item.finishedGoodProfile || !isCanonicalPieceUnit(line.item.stockUnit))
          throw new SalesOrderRepositoryError(
            "invalid-reference",
            "Sales-order redelivery requires a finished good with a canonical piece unit.",
          );
        const dispatched = quantities.dispatched.get(line.id) ?? new Decimal(0);
        const refused = quantities.refused.get(line.id) ?? new Decimal(0);
        const remaining = Decimal.max(
          0,
          new Decimal(line.totalPieces.toString()).sub(dispatched).add(refused),
        );
        const reserved = quantities.reserved.get(line.id) ?? new Decimal(0);
        const additional = Decimal.max(0, remaining.sub(reserved));
        return additional.gt(0)
          ? [
              {
                operation: "RESERVE" as const,
                salesOrderId: order.id,
                salesOrderNumber: order.number,
                salesOrderLineId: line.id,
                itemId: line.itemId,
                warehouseId: order.warehouseId,
                canonicalUnitId: line.canonicalUnitId,
                quantity: additional.toFixed(),
                actorUserId,
              },
            ]
          : [];
      });
      if (!commands.length)
        throw new SalesOrderRepositoryError(
          "invalid-state",
          "This sales order has no unreserved quantity awaiting redelivery.",
        );
      await postSalesOrderReservationInventory(transaction, commands);
    });
  }

  async cancelSalesOrder(id: string, reason: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const order = await transaction.salesOrder.findUnique({
        where: { id },
        include: {
          lines: true,
          dispatches: { where: { status: { in: ["POSTED", "DELIVERED"] } }, select: { id: true } },
        },
      });
      if (!order) throw new SalesOrderRepositoryError("not-found", "Sales order no longer exists.");
      if (!(["DRAFT", "APPROVED"] as const).includes(order.status as "DRAFT" | "APPROVED"))
        throw new SalesOrderRepositoryError(
          "invalid-state",
          "This sales order is not eligible for cancellation.",
        );
      if (order.dispatches.length)
        throw new SalesOrderRepositoryError(
          "invalid-state",
          "A sales order with posted dispatches cannot be cancelled.",
        );
      if (order.status === "APPROVED")
        await postSalesOrderReservationInventory(
          transaction,
          order.lines.map((line) => ({
            operation: "RELEASE" as const,
            salesOrderId: order.id,
            salesOrderNumber: order.number,
            salesOrderLineId: line.id,
            itemId: line.itemId,
            warehouseId: order.warehouseId,
            canonicalUnitId: line.canonicalUnitId,
            quantity: line.totalPieces.toString(),
            actorUserId,
          })),
        );
      await transaction.salesOrder.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledByUserId: actorUserId,
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
      });
    });
  }

  async getSalesOrder(id: string) {
    const row = await prisma.salesOrder.findUnique({ where: { id }, include: orderInclude });
    return row
      ? mapOrder(
          row,
          await lineQuantities(
            prisma,
            row.lines.map((line) => line.id),
            row.warehouseId,
          ),
        )
      : null;
  }

  async listSalesOrders(
    query: SalesOrderQuery,
  ): Promise<SalesOrderPage<Omit<SalesOrderRecord, "lines">>> {
    const where = {
      ...(query.query ? { number: { contains: query.query, mode: "insensitive" as const } } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.salespersonId ? { salespersonId: query.salespersonId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            orderDate: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lte: query.dateTo } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await prisma.$transaction([
      prisma.salesOrder.count({ where }),
      prisma.salesOrder.findMany({
        where,
        include: orderInclude,
        orderBy: [{ orderDate: "desc" }, { number: "desc" }],
        skip: (query.page - 1) * SALES_ORDER_PAGE_SIZE,
        take: SALES_ORDER_PAGE_SIZE,
      }),
    ]);
    const records = await Promise.all(
      rows.map(async (row) => {
        const { lines, ...record } = mapOrder(
          row,
          await lineQuantities(
            prisma,
            row.lines.map((line) => line.id),
            row.warehouseId,
          ),
        );
        void lines;
        return record;
      }),
    );
    return {
      records,
      page: query.page,
      total,
      pageCount: Math.max(1, Math.ceil(total / SALES_ORDER_PAGE_SIZE)),
    };
  }
}

async function prepareOrder(transaction: Prisma.TransactionClient, input: SalesOrderInput) {
  const orderDate = parseDate(input.orderDate, "Order date");
  const deliveryDate = input.deliveryDate ? parseDate(input.deliveryDate, "Delivery date") : null;
  if (deliveryDate && deliveryDate < orderDate)
    throw new SalesOrderRepositoryError(
      "invalid-reference",
      "Delivery date cannot be before order date.",
    );
  const customer = await transaction.customer.findFirst({
    where: { id: input.customerId, active: true },
    include: { area: true, route: true, salesperson: true },
  });
  if (!customer)
    throw new SalesOrderRepositoryError("invalid-reference", "Select an active customer.");
  const areaId = input.areaId ?? customer.areaId;
  const routeId = input.routeId ?? (customer.route?.active ? customer.routeId : undefined);
  const salespersonId =
    input.salespersonId ?? (customer.salesperson?.active ? customer.salespersonId : undefined);
  const [area, route, salesperson, warehouse] = await Promise.all([
    transaction.salesArea.findFirst({ where: { id: areaId, active: true } }),
    routeId ? transaction.salesRoute.findFirst({ where: { id: routeId, active: true } }) : null,
    salespersonId
      ? transaction.salesperson.findFirst({ where: { id: salespersonId, active: true } })
      : null,
    transaction.warehouse.findFirst({ where: { id: input.warehouseId, active: true } }),
  ]);
  if (
    !area ||
    !warehouse ||
    (routeId && (!route || route.areaId !== area.id)) ||
    (salespersonId && !salesperson)
  )
    throw new SalesOrderRepositoryError(
      "invalid-reference",
      "Customer assignment or sales warehouse is inactive or invalid.",
    );
  const lines = await prepareLines(transaction, input.lines);
  return {
    header: {
      customerId: customer.id,
      salespersonId: salesperson?.id ?? null,
      salespersonName: salesperson?.name ?? null,
      areaId: area.id,
      areaName: area.name,
      routeId: route?.id ?? null,
      routeName: route?.name ?? null,
      warehouseId: warehouse.id,
      orderDate,
      deliveryDate,
      customerReference: input.customerReference ?? null,
      notes: input.notes ?? null,
      paymentTermsDays: customer.paymentTermsDays,
      customerCreditLimit: customer.creditLimit?.toString() ?? null,
    },
    lines,
    totals: calculateSalesOrderTotals(lines),
  };
}

async function prepareApproval(transaction: Prisma.TransactionClient, order: OrderRow) {
  const [customer, area, route, salesperson, warehouse] = await Promise.all([
    transaction.customer.findFirst({ where: { id: order.customerId, active: true } }),
    transaction.salesArea.findFirst({ where: { id: order.areaId, active: true } }),
    order.routeId
      ? transaction.salesRoute.findFirst({ where: { id: order.routeId, active: true } })
      : null,
    order.salespersonId
      ? transaction.salesperson.findFirst({ where: { id: order.salespersonId, active: true } })
      : null,
    transaction.warehouse.findFirst({ where: { id: order.warehouseId, active: true } }),
  ]);
  if (
    !customer ||
    !area ||
    !warehouse ||
    (order.routeId && (!route || route.areaId !== order.areaId)) ||
    (order.salespersonId && !salesperson)
  )
    throw new SalesOrderRepositoryError(
      "invalid-reference",
      "Sales-order references are no longer active or valid.",
    );
  const lines = await prepareLines(
    transaction,
    order.lines.map((line) => ({
      itemId: line.itemId,
      cartons: line.cartons.toString(),
      loosePieces: line.loosePieces.toString(),
      cartonRate: line.cartonRate.toString(),
      discount1Percent: line.discount1Percent.toString(),
      discount2Percent: line.discount2Percent.toString(),
      taxPercent: line.taxPercent.toString(),
      notes: line.notes ?? undefined,
    })),
  );
  return { lines, totals: calculateSalesOrderTotals(lines) };
}

async function prepareLines(
  transaction: Prisma.TransactionClient,
  inputLines: readonly SalesOrderLineInput[],
) {
  if (!inputLines.length)
    throw new SalesOrderRepositoryError(
      "invalid-reference",
      "At least one sales-order line is required.",
    );
  const items = await transaction.item.findMany({
    where: {
      id: { in: [...new Set(inputLines.map((line) => line.itemId))] },
      active: true,
      itemType: "FINISHED_GOOD",
    },
    include: { stockUnit: true, finishedGoodProfile: true },
  });
  return inputLines.map((line, index) => {
    const item = items.find((candidate) => candidate.id === line.itemId);
    if (!item || !validFinishedGood(item))
      throw new SalesOrderRepositoryError(
        "invalid-reference",
        `Line ${index + 1} must select an active finished good.`,
      );
    try {
      const calculated = calculateSalesOrderLine({
        ...line,
        piecesPerCarton: item.finishedGoodProfile!.piecesPerCarton,
      });
      return {
        itemId: item.id,
        itemType: "FINISHED_GOOD" as const,
        cartons: Number(calculated.cartons),
        loosePieces: Number(calculated.loosePieces),
        totalPieces: calculated.totalPieces,
        canonicalUnitId: item.stockUnitId,
        cartonRate: line.cartonRate,
        discount1Percent: line.discount1Percent || "0",
        discount2Percent: line.discount2Percent || "0",
        taxPercent: line.taxPercent || "0",
        pieceRate: calculated.pieceRate,
        grossAmount: calculated.grossAmount,
        discountAmount: calculated.discountAmount,
        taxAmount: calculated.taxAmount,
        netAmount: calculated.netAmount,
        notes: line.notes ?? null,
      };
    } catch (error) {
      throw new SalesOrderRepositoryError(
        "invalid-reference",
        error instanceof Error
          ? `Line ${index + 1}: ${error.message}`
          : `Line ${index + 1} is invalid.`,
      );
    }
  });
}

function validFinishedGood(item: FinishedGoodRow) {
  return (
    item.stockUnit.active &&
    isCanonicalPieceUnit(item.stockUnit) &&
    item.finishedGoodProfile !== null &&
    item.finishedGoodProfile.piecesPerCarton > 0
  );
}
function createLineData(line: Awaited<ReturnType<typeof prepareLines>>[number], position: number) {
  const { itemId, itemType, canonicalUnitId, ...data } = line;
  return {
    ...data,
    position,
    item: { connect: { id_itemType: { id: itemId, itemType } } },
    canonicalUnit: { connect: { id: canonicalUnitId } },
  };
}
async function lineQuantities(
  client: Prisma.TransactionClient | typeof prisma,
  lineIds: readonly string[],
  warehouseId: string,
) {
  const [available, reserved, dispatched, refused] = await Promise.all([
    client.inventoryMovement.groupBy({
      by: ["itemId"],
      where: { warehouseId, status: "AVAILABLE" },
      _sum: { quantity: true },
    }),
    client.inventoryMovement.groupBy({
      by: ["salesOrderLineId"],
      where: { salesOrderLineId: { in: [...lineIds] }, status: "RESERVED" },
      _sum: { quantity: true },
    }),
    client.salesDispatchLine.groupBy({
      by: ["salesOrderLineId"],
      where: {
        salesOrderLineId: { in: [...lineIds] },
        salesDispatch: { status: { in: ["POSTED", "DELIVERED"] } },
      },
      _sum: { totalPieces: true },
    }),
    client.salesReturnLine.findMany({
      where: {
        salesInvoiceLineId: null,
        salesDispatchLine: { salesOrderLineId: { in: [...lineIds] } },
        salesReturn: { type: "DISPATCH_REFUSAL", status: "COMPLETED" },
      },
      select: { totalPieces: true, salesDispatchLine: { select: { salesOrderLineId: true } } },
    }),
  ]);
  return {
    available,
    reserved: new Map(
      reserved
        .filter((row): row is typeof row & { salesOrderLineId: string } =>
          Boolean(row.salesOrderLineId),
        )
        .map((row) => [row.salesOrderLineId, new Decimal(row._sum.quantity?.toString() ?? "0")]),
    ),
    dispatched: new Map(
      dispatched.map((row) => [
        row.salesOrderLineId,
        new Decimal(row._sum.totalPieces?.toString() ?? "0"),
      ]),
    ),
    refused: refused.reduce((totals, line) => {
      totals.set(
        line.salesDispatchLine.salesOrderLineId,
        (totals.get(line.salesDispatchLine.salesOrderLineId) ?? new Decimal(0)).add(
          line.totalPieces.toString(),
        ),
      );
      return totals;
    }, new Map<string, Decimal>()),
  };
}
function mapOrder(
  row: OrderRow,
  stocks: Awaited<ReturnType<typeof lineQuantities>>,
): SalesOrderRecord {
  return {
    id: row.id,
    number: row.number,
    orderDate: row.orderDate,
    deliveryDate: row.deliveryDate,
    customerId: row.customerId,
    customerCode: row.customer.code,
    customerName: row.customer.name,
    salespersonId: row.salespersonId,
    salespersonName: row.salespersonName,
    areaId: row.areaId,
    areaName: row.areaName,
    routeId: row.routeId,
    routeName: row.routeName,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    status: row.status,
    customerReference: row.customerReference,
    notes: row.notes,
    paymentTermsDays: row.paymentTermsDays,
    customerCreditLimit: row.customerCreditLimit?.toString() ?? null,
    subtotal: row.subtotal.toString(),
    discountTotal: row.discountTotal.toString(),
    taxTotal: row.taxTotal.toString(),
    grandTotal: row.grandTotal.toString(),
    createdByName: row.createdBy.name,
    approvedByName: row.approvedBy?.name ?? null,
    approvedAt: row.approvedAt,
    cancelledByName: row.cancelledBy?.name ?? null,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lines: row.lines.map((line) => {
      const dispatched = stocks.dispatched.get(line.id) ?? new Decimal(0);
      const refused = stocks.refused.get(line.id) ?? new Decimal(0);
      const remaining = Decimal.max(
        0,
        new Decimal(line.totalPieces.toString()).sub(dispatched).add(refused),
      );
      const reserved = stocks.reserved.get(line.id) ?? new Decimal(0);
      return {
        id: line.id,
        position: line.position,
        itemId: line.itemId,
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
        notes: line.notes ?? undefined,
        availablePieces:
          stocks.available
            .find((value) => value.itemId === line.itemId)
            ?._sum.quantity?.toString() ?? "0",
        reservedPieces: reserved.toFixed(),
        dispatchedPieces: dispatched.toFixed(),
        refusedPieces: refused.toFixed(),
        remainingDeliveryPieces: remaining.toFixed(),
        redeliveryReservationPieces: Decimal.max(0, remaining.sub(reserved)).toFixed(),
      };
    }),
  };
}
async function nextNumber(transaction: Prisma.TransactionClient, year: number) {
  const sequence = await transaction.salesOrderSequence.upsert({
    where: { year },
    create: { year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return `SO-${year}-${String(sequence.nextValue - 1).padStart(6, "0")}`;
}
function parseDate(value: string, label: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new SalesOrderRepositoryError("invalid-reference", `${label} is invalid.`);
  return date;
}
async function serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 3
      )
        continue;
      throw mapError(error);
    }
  }
  throw new SalesOrderRepositoryError("conflict", "Sales-order transaction conflict; retry.");
}
function mapError(error: unknown) {
  if (error instanceof SalesOrderRepositoryError) return error;
  if (error instanceof InventoryRepositoryError)
    return new SalesOrderRepositoryError(
      error.reason === "stock" ? "stock" : "invalid-reference",
      error.message,
    );
  if (error instanceof CreditExposureError)
    return new SalesOrderRepositoryError("invalid-reference", error.message);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return new SalesOrderRepositoryError(
        "conflict",
        "A sales order with this number already exists.",
      );
    if (error.code === "P2025")
      return new SalesOrderRepositoryError("not-found", "Sales order no longer exists.");
  }
  return error instanceof Error
    ? error
    : new SalesOrderRepositoryError("conflict", "Sales order could not be saved.");
}
