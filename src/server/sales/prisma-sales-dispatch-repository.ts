import "server-only";

import Decimal from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import { InventoryRepositoryError } from "@/modules/inventory/application/contracts";
import { normalizeCartonQuantity } from "@/modules/quantity/domain/cartons";
import { isCanonicalPieceUnit } from "@/modules/quantity/domain/quantity";
import { SALES_ORDER_PAGE_SIZE } from "@/modules/sales/domain/sales-orders";
import type {
  DispatchOrderLine,
  SalesDispatchInput,
  SalesDispatchPage,
  SalesDispatchQuery,
  SalesDispatchRecord,
  SalesDispatchReferences,
  SalesDispatchRepository,
} from "@/modules/sales/application/sales-dispatch-contracts";
import { SalesDispatchRepositoryError } from "@/modules/sales/application/sales-dispatch-contracts";
import { postSalesDispatchInventory } from "@/server/inventory/transactional-inventory-posting";
import { prisma } from "@/server/db/prisma";

const dispatchInclude = {
  salesOrder: { include: { lines: true } },
  customer: true,
  sourceWarehouse: true,
  createdBy: true,
  postedBy: true,
  deliveredBy: true,
  cancelledBy: true,
  lines: {
    orderBy: { id: "asc" as const },
    include: {
      item: { include: { finishedGoodProfile: true } },
      salesOrderLine: true,
      allocations: {
        include: {
          productionLot: true,
          salesReturnLines: {
            where: {
              salesInvoiceLineId: null,
              salesReturn: { status: { in: ["RECEIVED", "INSPECTED", "COMPLETED"] } },
            },
          },
        },
      },
      invoiceLines: {
        where: { salesInvoice: { status: "POSTED" } },
        include: { salesInvoice: true },
      },
    },
  },
} satisfies Prisma.SalesDispatchInclude;
type DispatchRow = Prisma.SalesDispatchGetPayload<{ include: typeof dispatchInclude }>;
const allowedOrderStatuses = ["APPROVED", "PARTIALLY_DISPATCHED"] as const;

export class PrismaSalesDispatchRepository implements SalesDispatchRepository {
  async getSalesDispatchReferences(): Promise<SalesDispatchReferences> {
    const orders = await prisma.salesOrder.findMany({
      where: { status: { in: [...allowedOrderStatuses] } },
      include: { customer: true, warehouse: true },
      orderBy: [{ orderDate: "desc" }, { number: "desc" }],
      take: 1000,
    });
    return {
      orders: orders.map((order) => ({
        id: order.id,
        number: order.number,
        customerName: order.customer.name,
        warehouseName: order.warehouse.name,
        status: order.status as (typeof allowedOrderStatuses)[number],
      })),
    };
  }

  async getDispatchOrder(id: string) {
    const order = await prisma.salesOrder.findUnique({
      where: { id },
      include: {
        customer: true,
        warehouse: true,
        lines: {
          orderBy: { position: "asc" },
          include: { item: { include: { finishedGoodProfile: true } } },
        },
      },
    });
    if (
      !order ||
      !allowedOrderStatuses.includes(order.status as (typeof allowedOrderStatuses)[number])
    )
      return null;
    const quantities = await lineQuantities(
      prisma,
      order.lines.map((line) => line.id),
      order.warehouseId,
    );
    const lines: DispatchOrderLine[] = await Promise.all(
      order.lines.map(async (line) => {
        const posted = quantities.dispatched.get(line.id) ?? new Decimal(0);
        const reserved = quantities.reserved.get(line.id) ?? new Decimal(0);
        const ordered = new Decimal(line.totalPieces.toString());
        return {
          id: line.id,
          itemId: line.itemId,
          itemCode: line.item.code,
          itemName: line.item.name,
          piecesPerCarton: line.item.finishedGoodProfile?.piecesPerCarton ?? 0,
          orderedPieces: ordered.toFixed(),
          dispatchedPieces: posted.toFixed(),
          remainingPieces: Decimal.max(0, ordered.sub(posted)).toFixed(),
          reservedPieces: reserved.toFixed(),
          lots: await eligibleLots(prisma, line.itemId, order.warehouseId, new Date()),
        };
      }),
    );
    return {
      id: order.id,
      number: order.number,
      customerName: order.customer.name,
      warehouseName: order.warehouse.name,
      lines,
    };
  }

  async createSalesDispatch(input: SalesDispatchInput) {
    return serializable(async (tx) => createOrUpdate(tx, input));
  }
  async updateSalesDispatch(input: SalesDispatchInput & { id: string }) {
    return serializable(async (tx) => {
      const current = await tx.salesDispatch.findUnique({
        where: { id: input.id },
        select: { status: true },
      });
      if (!current)
        throw new SalesDispatchRepositoryError("not-found", "Dispatch no longer exists.");
      if (current.status !== "DRAFT")
        throw new SalesDispatchRepositoryError(
          "invalid-state",
          "Only draft dispatches can be edited.",
        );
      return createOrUpdate(tx, input);
    });
  }

  async getSalesDispatch(id: string) {
    const row = await prisma.salesDispatch.findUnique({ where: { id }, include: dispatchInclude });
    return row
      ? mapDispatch(
          row,
          await lineQuantities(
            prisma,
            row.lines.map((line) => line.salesOrderLineId),
            row.sourceWarehouseId,
          ),
        )
      : null;
  }
  async listSalesDispatches(
    query: SalesDispatchQuery,
  ): Promise<SalesDispatchPage<Omit<SalesDispatchRecord, "lines">>> {
    const where = {
      ...(query.query
        ? {
            OR: [
              { number: { contains: query.query, mode: "insensitive" as const } },
              { salesOrder: { number: { contains: query.query, mode: "insensitive" as const } } },
              { customer: { name: { contains: query.query, mode: "insensitive" as const } } },
            ],
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.salesOrderId ? { salesOrderId: query.salesOrderId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            dispatchAt: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lte: query.dateTo } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await prisma.$transaction([
      prisma.salesDispatch.count({ where }),
      prisma.salesDispatch.findMany({
        where,
        include: dispatchInclude,
        orderBy: [{ dispatchAt: "desc" }, { number: "desc" }],
        skip: (query.page - 1) * SALES_ORDER_PAGE_SIZE,
        take: SALES_ORDER_PAGE_SIZE,
      }),
    ]);
    const records = await Promise.all(
      rows.map(async (row) => {
        const { lines, ...record } = mapDispatch(
          row,
          await lineQuantities(
            prisma,
            row.lines.map((line) => line.salesOrderLineId),
            row.sourceWarehouseId,
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

  async postSalesDispatch(id: string, actorUserId: string) {
    await serializable(async (tx) => {
      const dispatch = await tx.salesDispatch.findUnique({
        where: { id },
        include: dispatchInclude,
      });
      if (!dispatch)
        throw new SalesDispatchRepositoryError("not-found", "Dispatch no longer exists.");
      if (dispatch.status !== "DRAFT")
        throw new SalesDispatchRepositoryError(
          "invalid-state",
          "Only a draft dispatch can be posted.",
        );
      const prepared = await validateDraft(tx, dispatch, dispatch.dispatchAt);
      await postSalesDispatchInventory(
        tx,
        prepared.flatMap((line) =>
          line.allocations.map((allocation) => ({
            salesDispatchId: dispatch.id,
            salesDispatchNumber: dispatch.number,
            salesDispatchLineId: line.id,
            salesDispatchAllocationId: allocation.id,
            salesOrderId: dispatch.salesOrderId,
            salesOrderLineId: line.salesOrderLineId,
            itemId: line.itemId,
            warehouseId: dispatch.sourceWarehouseId,
            canonicalUnitId: line.salesOrderLine.canonicalUnitId,
            productionLotId: allocation.productionLotId,
            quantity: allocation.quantity.toString(),
            dispatchAt: dispatch.dispatchAt,
            actorUserId,
          })),
        ),
      );
      const quantities = await lineQuantities(
        tx,
        dispatch.salesOrder.lines.map((line) => line.id),
        dispatch.sourceWarehouseId,
      );
      const posted = await tx.salesDispatchLine.groupBy({
        by: ["salesOrderLineId"],
        where: {
          salesDispatch: {
            salesOrderId: dispatch.salesOrderId,
            status: { in: ["POSTED", "DELIVERED"] },
          },
        },
        _sum: { totalPieces: true },
      });
      const totalWithCurrent = new Map(
        posted.map((row) => [
          row.salesOrderLineId,
          new Decimal(row._sum.totalPieces?.toString() ?? "0"),
        ]),
      );
      for (const line of dispatch.lines)
        totalWithCurrent.set(
          line.salesOrderLineId,
          (totalWithCurrent.get(line.salesOrderLineId) ?? new Decimal(0)).add(
            line.totalPieces.toString(),
          ),
        );
      const fullyDispatched = dispatch.salesOrder.lines.every((line) =>
        (totalWithCurrent.get(line.id) ?? new Decimal(0))
          .sub(quantities.refused.get(line.id) ?? new Decimal(0))
          .eq(line.totalPieces.toString()),
      );
      await tx.salesDispatch.update({
        where: { id },
        data: { status: "POSTED", postedByUserId: actorUserId, postedAt: new Date() },
      });
      await tx.salesOrder.update({
        where: { id: dispatch.salesOrderId },
        data: { status: fullyDispatched ? "DISPATCHED" : "PARTIALLY_DISPATCHED" },
      });
    });
  }

  async confirmSalesDispatchDelivery(
    id: string,
    receiverName: string | undefined,
    notes: string | undefined,
    actorUserId: string,
  ) {
    await serializable(async (tx) => {
      const dispatch = await tx.salesDispatch.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!dispatch)
        throw new SalesDispatchRepositoryError("not-found", "Dispatch no longer exists.");
      if (dispatch.status !== "POSTED")
        throw new SalesDispatchRepositoryError(
          "invalid-state",
          "Only a posted dispatch can be marked delivered.",
        );
      await tx.salesDispatch.update({
        where: { id },
        data: {
          status: "DELIVERED",
          deliveredByUserId: actorUserId,
          deliveredAt: new Date(),
          receiverName: receiverName ?? null,
          deliveryNotes: notes ?? null,
        },
      });
    });
  }
  async cancelSalesDispatch(id: string, reason: string, actorUserId: string) {
    await serializable(async (tx) => {
      const dispatch = await tx.salesDispatch.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!dispatch)
        throw new SalesDispatchRepositoryError("not-found", "Dispatch no longer exists.");
      if (dispatch.status !== "DRAFT")
        throw new SalesDispatchRepositoryError(
          "invalid-state",
          "Only a draft dispatch can be cancelled.",
        );
      await tx.salesDispatch.update({
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
}

async function createOrUpdate(
  tx: Prisma.TransactionClient,
  input: SalesDispatchInput & { id?: string },
) {
  const prepared = await prepareDispatch(tx, input);
  const id = input.id;
  if (id) {
    await tx.salesDispatchLine.deleteMany({ where: { salesDispatchId: id } });
    await tx.salesDispatch.update({
      where: { id },
      data: { ...prepared.header, lines: { create: prepared.lines } },
    });
    return id;
  }
  const number = await nextNumber(tx, prepared.header.dispatchAt.getUTCFullYear());
  return (
    await tx.salesDispatch.create({
      data: {
        number,
        ...prepared.header,
        createdByUserId: input.actorUserId,
        lines: { create: prepared.lines },
      },
    })
  ).id;
}
async function prepareDispatch(tx: Prisma.TransactionClient, input: SalesDispatchInput) {
  const dispatchAt = parseDate(input.dispatchDate);
  const order = await tx.salesOrder.findUnique({
    where: { id: input.salesOrderId },
    include: {
      customer: true,
      warehouse: true,
      lines: { include: { item: { include: { stockUnit: true, finishedGoodProfile: true } } } },
    },
  });
  if (
    !order ||
    !allowedOrderStatuses.includes(order.status as (typeof allowedOrderStatuses)[number]) ||
    !order.customer.active ||
    !order.warehouse.active
  )
    throw new SalesDispatchRepositoryError(
      "invalid-reference",
      "Select an approved or partially dispatched sales order with active delivery references.",
    );
  const quantities = await lineQuantities(
    tx,
    order.lines.map((line) => line.id),
    order.warehouseId,
  );
  const seen = new Set<string>();
  const lines = await Promise.all(
    input.lines.map(async (line, index) => {
      if (seen.has(line.salesOrderLineId))
        throw new SalesDispatchRepositoryError(
          "invalid-reference",
          "A sales-order line can appear only once in a dispatch.",
        );
      seen.add(line.salesOrderLineId);
      const orderLine = order.lines.find((candidate) => candidate.id === line.salesOrderLineId);
      if (
        !orderLine ||
        !orderLine.item.finishedGoodProfile ||
        !isCanonicalPieceUnit(orderLine.item.stockUnit)
      )
        throw new SalesDispatchRepositoryError(
          "invalid-reference",
          `Dispatch line ${index + 1} is not an eligible finished good.`,
        );
      const breakdown = cartonBreakdown(
        line.cartons,
        line.loosePieces,
        orderLine.item.finishedGoodProfile.piecesPerCarton,
        index + 1,
      );
      const alreadyDispatched = quantities.dispatched.get(orderLine.id) ?? new Decimal(0);
      const refused = quantities.refused.get(orderLine.id) ?? new Decimal(0);
      const remaining = new Decimal(orderLine.totalPieces.toString())
        .sub(alreadyDispatched)
        .add(refused);
      if (new Decimal(breakdown.totalPieces).gt(remaining))
        throw new SalesDispatchRepositoryError(
          "stock",
          `Dispatch line ${index + 1} exceeds the remaining sales-order quantity.`,
        );
      const allocated = await prepareAllocations(
        tx,
        line.allocations,
        orderLine.itemId,
        dispatchAt,
        breakdown.totalPieces,
        index + 1,
      );
      return {
        salesOrderLineId: orderLine.id,
        itemId: orderLine.itemId,
        cartons: Number(breakdown.cartons),
        loosePieces: Number(breakdown.loosePieces),
        totalPieces: breakdown.totalPieces,
        notes: line.notes ?? null,
        allocations: { create: allocated },
      };
    }),
  );
  return {
    header: {
      salesOrderId: order.id,
      customerId: order.customerId,
      dispatchAt,
      sourceWarehouseId: order.warehouseId,
      deliveryAddress: deliveryAddress(order.customer),
      routeName: order.routeName,
      salespersonName: order.salespersonName,
      vehicleNumber: input.vehicleNumber ?? null,
      driverName: input.driverName ?? null,
      driverPhone: input.driverPhone ?? null,
      transporter: input.transporter ?? null,
      gatePassReference: input.gatePassReference ?? null,
      notes: input.notes ?? null,
    },
    lines,
  };
}
async function prepareAllocations(
  tx: Prisma.TransactionClient,
  input: readonly { productionLotId: string; quantity: string }[],
  itemId: string,
  dispatchAt: Date,
  expected: string,
  position: number,
) {
  const ids = [...new Set(input.map((entry) => entry.productionLotId))];
  if (ids.length !== input.length)
    throw new SalesDispatchRepositoryError(
      "invalid-reference",
      `Dispatch line ${position} repeats a production lot.`,
    );
  const lots = await tx.productionLot.findMany({
    where: { id: { in: ids }, finishedGoodId: itemId },
  });
  if (lots.length !== ids.length)
    throw new SalesDispatchRepositoryError(
      "invalid-reference",
      `Dispatch line ${position} has an invalid production lot.`,
    );
  let total = new Decimal(0);
  const allocations = input.map((entry) => {
    const quantity = positive(entry.quantity, `Lot allocation on line ${position}`);
    const lot = lots.find((candidate) => candidate.id === entry.productionLotId)!;
    if (lot.expiryDate && lot.expiryDate < dispatchAt)
      throw new SalesDispatchRepositoryError(
        "invalid-reference",
        `Production lot ${lot.lotNumber} is expired.`,
      );
    total = total.add(quantity);
    return { productionLotId: lot.id, quantity: quantity.toFixed() };
  });
  if (!total.eq(expected))
    throw new SalesDispatchRepositoryError(
      "invalid-reference",
      `Lot allocations on dispatch line ${position} must equal its piece quantity.`,
    );
  return allocations;
}
async function validateDraft(
  tx: Prisma.TransactionClient,
  dispatch: DispatchRow,
  dispatchAt: Date,
) {
  if (
    !allowedOrderStatuses.includes(
      dispatch.salesOrder.status as (typeof allowedOrderStatuses)[number],
    )
  )
    throw new SalesDispatchRepositoryError(
      "invalid-state",
      "The sales order is no longer eligible for dispatch.",
    );
  const quantities = await lineQuantities(
    tx,
    dispatch.salesOrder.lines.map((line) => line.id),
    dispatch.sourceWarehouseId,
  );
  const otherPosted = await tx.salesDispatchLine.groupBy({
    by: ["salesOrderLineId"],
    where: {
      salesDispatch: {
        salesOrderId: dispatch.salesOrderId,
        status: { in: ["POSTED", "DELIVERED"] },
      },
    },
    _sum: { totalPieces: true },
  });
  const used = new Map(
    otherPosted.map((row) => [
      row.salesOrderLineId,
      new Decimal(row._sum.totalPieces?.toString() ?? "0"),
    ]),
  );
  for (const line of dispatch.lines) {
    const orderLine = dispatch.salesOrder.lines.find(
      (candidate) => candidate.id === line.salesOrderLineId,
    );
    if (!orderLine || orderLine.itemId !== line.itemId)
      throw new SalesDispatchRepositoryError(
        "invalid-reference",
        "Dispatch line no longer belongs to this sales order.",
      );
    const remaining = new Decimal(orderLine.totalPieces.toString())
      .sub(used.get(line.salesOrderLineId) ?? 0)
      .add(quantities.refused.get(line.salesOrderLineId) ?? 0);
    if (new Decimal(line.totalPieces.toString()).gt(remaining))
      throw new SalesDispatchRepositoryError(
        "stock",
        "Dispatch exceeds the recalculated remaining order quantity.",
      );
    const reserved = quantities.reserved.get(line.salesOrderLineId) ?? new Decimal(0);
    if (reserved.lt(line.totalPieces.toString()))
      throw new SalesDispatchRepositoryError(
        "stock",
        "Dispatch line no longer has enough reserved stock.",
      );
    const allocated = line.allocations.reduce(
      (sum, allocation) => sum.add(allocation.quantity.toString()),
      new Decimal(0),
    );
    if (!allocated.eq(line.totalPieces.toString()))
      throw new SalesDispatchRepositoryError(
        "invalid-reference",
        "Dispatch lot allocations no longer reconcile.",
      );
    for (const allocation of line.allocations)
      if (
        allocation.productionLot.finishedGoodId !== line.itemId ||
        (allocation.productionLot.expiryDate && allocation.productionLot.expiryDate < dispatchAt)
      )
        throw new SalesDispatchRepositoryError(
          "invalid-reference",
          "Dispatch contains an invalid or expired production lot.",
        );
  }
  return dispatch.lines;
}
async function lineQuantities(
  client: Prisma.TransactionClient | typeof prisma,
  lineIds: readonly string[],
  warehouseId: string,
) {
  const [reservedRows, dispatchRows, refusalRows] = await Promise.all([
    client.inventoryMovement.groupBy({
      by: ["salesOrderLineId"],
      where: { salesOrderLineId: { in: [...lineIds] }, warehouseId, status: "RESERVED" },
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
    reserved: new Map(
      reservedRows
        .filter((row): row is typeof row & { salesOrderLineId: string } =>
          Boolean(row.salesOrderLineId),
        )
        .map((row) => [row.salesOrderLineId, new Decimal(row._sum.quantity?.toString() ?? "0")]),
    ),
    dispatched: new Map(
      dispatchRows.map((row) => [
        row.salesOrderLineId,
        new Decimal(row._sum.totalPieces?.toString() ?? "0"),
      ]),
    ),
    refused: refusalRows.reduce((totals, row) => {
      const lineId = row.salesDispatchLine.salesOrderLineId;
      totals.set(lineId, (totals.get(lineId) ?? new Decimal(0)).add(row.totalPieces.toString()));
      return totals;
    }, new Map<string, Decimal>()),
  };
}
async function eligibleLots(
  client: Prisma.TransactionClient | typeof prisma,
  itemId: string,
  warehouseId: string,
  dispatchAt: Date,
) {
  const lots = await client.productionLot.findMany({
    where: {
      finishedGoodId: itemId,
      OR: [{ expiryDate: null }, { expiryDate: { gte: dispatchAt } }],
    },
    orderBy: [
      { expiryDate: { sort: "asc", nulls: "last" } },
      { productionDate: "asc" },
      { lotNumber: "asc" },
    ],
  });
  const balances = await client.inventoryMovement.groupBy({
    by: ["productionLotId"],
    where: {
      itemId,
      warehouseId,
      status: "AVAILABLE",
      productionLotId: { in: lots.map((lot) => lot.id) },
    },
    _sum: { quantity: true },
  });
  return lots
    .map((lot) => ({
      id: lot.id,
      lotNumber: lot.lotNumber,
      expiryDate: lot.expiryDate,
      availablePieces:
        balances.find((row) => row.productionLotId === lot.id)?._sum.quantity?.toString() ?? "0",
    }))
    .filter((lot) => new Decimal(lot.availablePieces).gt(0));
}
function cartonBreakdown(
  cartons: string,
  loosePieces: string,
  piecesPerCarton: number,
  position: number,
) {
  try {
    const value = normalizeCartonQuantity(cartons, loosePieces, piecesPerCarton);
    if (new Decimal(value.totalPieces).lte(0))
      throw new Error("Quantity must be greater than zero.");
    return value;
  } catch (error) {
    throw new SalesDispatchRepositoryError(
      "invalid-reference",
      `Dispatch line ${position}: ${error instanceof Error ? error.message : "quantity is invalid."}`,
    );
  }
}
function positive(value: string, label: string) {
  try {
    const result = new Decimal(value);
    if (!result.isFinite() || result.lte(0) || result.decimalPlaces() > 6) throw new Error();
    return result;
  } catch {
    throw new SalesDispatchRepositoryError(
      "invalid-reference",
      `${label} must be a positive canonical quantity.`,
    );
  }
}
function deliveryAddress(customer: { address: string | null; city: string | null }) {
  return (
    [customer.address, customer.city].filter(Boolean).join(", ") || "Delivery address not recorded"
  );
}
function parseDate(value: string) {
  const result = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(result.valueOf()) ||
    result.toISOString().slice(0, 10) !== value
  )
    throw new SalesDispatchRepositoryError("invalid-reference", "Dispatch date is invalid.");
  return result;
}
function mapDispatch(
  row: DispatchRow,
  quantities: Awaited<ReturnType<typeof lineQuantities>>,
): SalesDispatchRecord {
  return {
    id: row.id,
    number: row.number,
    salesOrderId: row.salesOrderId,
    salesOrderNumber: row.salesOrder.number,
    customerName: row.customer.name,
    customerCode: row.customer.code,
    dispatchAt: row.dispatchAt,
    sourceWarehouseId: row.sourceWarehouseId,
    warehouseName: row.sourceWarehouse.name,
    deliveryAddress: row.deliveryAddress,
    routeName: row.routeName,
    salespersonName: row.salespersonName,
    vehicleNumber: row.vehicleNumber,
    driverName: row.driverName,
    driverPhone: row.driverPhone,
    transporter: row.transporter,
    gatePassReference: row.gatePassReference,
    notes: row.notes,
    status: row.status,
    createdByName: row.createdBy.name,
    postedByName: row.postedBy?.name ?? null,
    postedAt: row.postedAt,
    deliveredByName: row.deliveredBy?.name ?? null,
    deliveredAt: row.deliveredAt,
    receiverName: row.receiverName,
    deliveryNotes: row.deliveryNotes,
    cancelledByName: row.cancelledBy?.name ?? null,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lines: row.lines.map((line) => {
      const ordered = new Decimal(line.salesOrderLine.totalPieces.toString());
      const dispatched = quantities.dispatched.get(line.salesOrderLineId) ?? new Decimal(0);
      const refusedForOrderLine = quantities.refused.get(line.salesOrderLineId) ?? new Decimal(0);
      const invoiced = line.invoiceLines.reduce(
        (total, invoiceLine) => total.add(invoiceLine.totalPieces.toString()),
        new Decimal(0),
      );
      const refused = line.allocations.reduce(
        (total, allocation) =>
          total.add(
            allocation.salesReturnLines.reduce(
              (returns, salesReturn) => returns.add(salesReturn.totalPieces.toString()),
              new Decimal(0),
            ),
          ),
        new Decimal(0),
      );
      return {
        id: line.id,
        salesOrderLineId: line.salesOrderLineId,
        itemId: line.itemId,
        itemCode: line.item.code,
        itemName: line.item.name,
        piecesPerCarton: line.item.finishedGoodProfile?.piecesPerCarton ?? 0,
        cartons: line.cartons.toString(),
        loosePieces: line.loosePieces.toString(),
        totalPieces: line.totalPieces.toString(),
        notes: line.notes,
        orderedPieces: ordered.toFixed(),
        dispatchedPieces: dispatched.toFixed(),
        refusedPieces: refusedForOrderLine.toFixed(),
        remainingPieces: Decimal.max(0, ordered.sub(dispatched).add(refusedForOrderLine)).toFixed(),
        reservedPieces: (
          quantities.reserved.get(line.salesOrderLineId) ?? new Decimal(0)
        ).toFixed(),
        invoicedPieces: invoiced.toFixed(),
        invoiceablePieces: Decimal.max(
          0,
          new Decimal(line.totalPieces.toString()).sub(invoiced).sub(refused),
        ).toFixed(),
        invoices: line.invoiceLines.map((invoiceLine) => ({
          id: invoiceLine.salesInvoiceId,
          number: invoiceLine.salesInvoice.number,
          quantity: invoiceLine.totalPieces.toString(),
        })),
        allocations: line.allocations.map((allocation) => ({
          id: allocation.productionLotId,
          lotNumber: allocation.productionLot.lotNumber,
          expiryDate: allocation.productionLot.expiryDate,
          availablePieces: "0",
          quantity: allocation.quantity.toString(),
        })),
      };
    }),
  };
}
async function nextNumber(tx: Prisma.TransactionClient, year: number) {
  const sequence = await tx.salesDispatchSequence.upsert({
    where: { year },
    create: { year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return `DN-${year}-${String(sequence.nextValue - 1).padStart(6, "0")}`;
}
async function serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1)
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
  throw new SalesDispatchRepositoryError("conflict", "Dispatch transaction conflict; retry.");
}
function mapError(error: unknown) {
  if (error instanceof SalesDispatchRepositoryError) return error;
  if (error instanceof InventoryRepositoryError)
    return new SalesDispatchRepositoryError(
      error.reason === "stock" ? "stock" : "invalid-reference",
      error.message,
    );
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return new SalesDispatchRepositoryError("conflict", "A dispatch number already exists.");
    if (error.code === "P2025")
      return new SalesDispatchRepositoryError("not-found", "Dispatch no longer exists.");
  }
  return error instanceof Error
    ? error
    : new SalesDispatchRepositoryError("conflict", "Dispatch could not be saved.");
}
