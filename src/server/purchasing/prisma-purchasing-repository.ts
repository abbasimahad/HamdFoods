import "server-only";

import Decimal from "decimal.js";

import { Prisma } from "@/generated/prisma/client";
import type {
  PageResult,
  PurchaseCatalogItem,
  PurchaseCatalogUnit,
  PurchaseOrderInput,
  PurchaseOrderLineInput,
  PurchaseOrderListRecord,
  PurchaseOrderQuery,
  PurchaseOrderRecord,
  PurchasingRepository,
  SupplierInput,
  SupplierRecord,
} from "@/modules/purchasing/application/contracts";
import { PurchasingRepositoryError } from "@/modules/purchasing/application/contracts";
import {
  PURCHASE_PAGE_SIZE,
  calculatePurchaseLine,
  calculatePurchaseTotals,
} from "@/modules/purchasing/domain/purchasing";
import {
  isSupportedQuantityUnitCode,
  normalizeQuantity,
  supportedQuantityUnitDimension,
} from "@/modules/quantity/domain/quantity";
import { prisma } from "@/server/db/prisma";

const orderInclude = {
  supplier: true,
  createdBy: true,
  approvedBy: true,
  cancelledBy: true,
  lines: {
    include: { item: true, orderUnit: true, canonicalUnit: true },
    orderBy: { position: "asc" as const },
  },
} satisfies Prisma.PurchaseOrderInclude;

type OrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>;
type PurchasableItemRow = Prisma.ItemGetPayload<{ include: { stockUnit: true } }>;
type UnitRow = Prisma.UnitGetPayload<Record<string, never>>;

export class PrismaPurchasingRepository implements PurchasingRepository {
  async listSuppliers(query: string, page: number): Promise<PageResult<SupplierRecord>> {
    const term = query.trim();
    const where = term
      ? {
          OR: [
            { code: { contains: term, mode: "insensitive" as const } },
            { name: { contains: term, mode: "insensitive" as const } },
            { city: { contains: term, mode: "insensitive" as const } },
          ],
        }
      : {};
    const [total, records] = await prisma.$transaction([
      prisma.supplier.count({ where }),
      prisma.supplier.findMany({
        where,
        orderBy: [{ active: "desc" }, { name: "asc" }],
        skip: (page - 1) * PURCHASE_PAGE_SIZE,
        take: PURCHASE_PAGE_SIZE,
      }),
    ]);
    return paged(records, page, total);
  }

  async listActiveSuppliers() {
    return prisma.supplier.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      take: 500,
    });
  }

  async getSupplier(id: string) {
    return prisma.supplier.findUnique({ where: { id } });
  }

  async saveSupplier(input: SupplierInput) {
    try {
      const data = {
        code: input.code,
        name: input.name,
        contactPerson: input.contactPerson,
        phone: input.phone,
        secondaryPhone: input.secondaryPhone,
        email: input.email,
        address: input.address,
        city: input.city,
        taxRegistrationNo: input.taxRegistrationNo,
        paymentTermsDays: input.paymentTermsDays,
        notes: input.notes,
      };
      return input.id
        ? (await prisma.supplier.update({ where: { id: input.id }, data })).id
        : (await prisma.supplier.create({ data })).id;
    } catch (error) {
      throw mapError(error, "supplier");
    }
  }

  async setSupplierActive(id: string, active: boolean) {
    return serializable(async (transaction) => {
      if (!active) {
        const draftOrders = await transaction.purchaseOrder.count({
          where: { supplierId: id, status: "DRAFT" },
        });
        if (draftOrders > 0) {
          throw new PurchasingRepositoryError(
            "invalid-state",
            "Approve or cancel this supplier's draft purchase orders before deactivation.",
          );
        }
      }
      return (
        (await transaction.supplier.updateMany({ where: { id }, data: { active } })).count === 1
      );
    });
  }

  async listCatalogItems(): Promise<readonly PurchaseCatalogItem[]> {
    const rows = await prisma.item.findMany({
      where: {
        active: true,
        itemType: { in: ["RAW_MATERIAL", "PACKAGING_MATERIAL"] },
        stockUnit: { active: true },
      },
      include: { stockUnit: true },
      orderBy: [{ itemType: "asc" }, { name: "asc" }],
      take: 1000,
    });
    return rows
      .filter(
        (row) =>
          isSupportedQuantityUnitCode(row.stockUnit.code) &&
          supportedQuantityUnitDimension(row.stockUnit.code) === row.stockUnit.dimension,
      )
      .map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        itemType: row.itemType,
        stockUnitDimension: row.stockUnit.dimension,
      }));
  }

  async listCatalogUnits(): Promise<readonly PurchaseCatalogUnit[]> {
    const rows = await prisma.unit.findMany({
      where: { active: true },
      orderBy: [{ dimension: "asc" }, { name: "asc" }],
    });
    return rows.filter(
      (row) =>
        isSupportedQuantityUnitCode(row.code) &&
        supportedQuantityUnitDimension(row.code) === row.dimension,
    );
  }

  async createPurchaseOrder(input: PurchaseOrderInput) {
    return serializable(async (transaction) => {
      const orderDate = parseDate(input.orderDate, "Order date");
      const expectedDeliveryDate = input.expectedDeliveryDate
        ? parseDate(input.expectedDeliveryDate, "Expected delivery date")
        : null;
      requireDeliveryDate(orderDate, expectedDeliveryDate);
      const prepared = await prepareOrder(transaction, input);
      const number = await nextOrderNumber(transaction, orderDate.getUTCFullYear());
      return (
        await transaction.purchaseOrder.create({
          data: {
            number,
            supplierId: input.supplierId,
            orderDate,
            expectedDeliveryDate,
            supplierReference: input.supplierReference ?? null,
            notes: input.notes ?? null,
            ...prepared.totals,
            createdByUserId: input.actorUserId,
            lines: {
              create: prepared.lines.map((line, index) => ({ ...line, position: index + 1 })),
            },
          },
        })
      ).id;
    });
  }

  async updatePurchaseOrder(input: PurchaseOrderInput & { id: string }) {
    return serializable(async (transaction) => {
      const current = await transaction.purchaseOrder.findUnique({
        where: { id: input.id },
        select: { status: true },
      });
      if (!current)
        throw new PurchasingRepositoryError("not-found", "Purchase order no longer exists.");
      if (current.status !== "DRAFT")
        throw new PurchasingRepositoryError(
          "invalid-state",
          "Only draft purchase orders can be edited.",
        );
      const orderDate = parseDate(input.orderDate, "Order date");
      const expectedDeliveryDate = input.expectedDeliveryDate
        ? parseDate(input.expectedDeliveryDate, "Expected delivery date")
        : null;
      requireDeliveryDate(orderDate, expectedDeliveryDate);
      const prepared = await prepareOrder(transaction, input);
      await transaction.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: input.id } });
      await transaction.purchaseOrder.update({
        where: { id: input.id },
        data: {
          supplierId: input.supplierId,
          orderDate,
          expectedDeliveryDate,
          supplierReference: input.supplierReference ?? null,
          notes: input.notes ?? null,
          ...prepared.totals,
          lines: {
            create: prepared.lines.map((line, index) => ({ ...line, position: index + 1 })),
          },
        },
      });
      return input.id;
    });
  }

  async approvePurchaseOrder(id: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const order = await transaction.purchaseOrder.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!order)
        throw new PurchasingRepositoryError("not-found", "Purchase order no longer exists.");
      if (order.status !== "DRAFT")
        throw new PurchasingRepositoryError(
          "invalid-state",
          "Only a draft purchase order can be approved.",
        );
      const prepared = await prepareOrder(transaction, {
        supplierId: order.supplierId,
        orderDate: dateInput(order.orderDate),
        expectedDeliveryDate: order.expectedDeliveryDate
          ? dateInput(order.expectedDeliveryDate)
          : undefined,
        supplierReference: order.supplierReference ?? undefined,
        notes: order.notes ?? undefined,
        actorUserId,
        lines: order.lines
          .sort((a, b) => a.position - b.position)
          .map((line) => ({
            itemId: line.itemId,
            quantity: line.orderedQuantity.toString(),
            unitId: line.orderUnitId,
            unitRate: line.unitRate.toString(),
            discountPercent: line.discountPercent.toString(),
            taxPercent: line.taxPercent.toString(),
            notes: line.notes ?? undefined,
          })),
      });
      for (const [index, line] of prepared.lines.entries()) {
        await transaction.purchaseOrderLine.update({
          where: { purchaseOrderId_position: { purchaseOrderId: id, position: index + 1 } },
          data: line,
        });
      }
      await transaction.purchaseOrder.update({
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

  async cancelPurchaseOrder(id: string, reason: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const order = await transaction.purchaseOrder.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!order)
        throw new PurchasingRepositoryError("not-found", "Purchase order no longer exists.");
      if (!(["DRAFT", "APPROVED"] as const).includes(order.status as "DRAFT" | "APPROVED")) {
        throw new PurchasingRepositoryError(
          "invalid-state",
          "This purchase order is not eligible for cancellation.",
        );
      }
      await transaction.purchaseOrder.update({
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

  async getPurchaseOrder(id: string) {
    const row = await prisma.purchaseOrder.findUnique({ where: { id }, include: orderInclude });
    return row ? mapOrder(row) : null;
  }

  async listPurchaseOrders(
    query: PurchaseOrderQuery,
  ): Promise<PageResult<PurchaseOrderListRecord>> {
    const where = {
      ...(query.query ? { number: { contains: query.query, mode: "insensitive" as const } } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            orderDate: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lt: query.dateTo } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await prisma.$transaction([
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.findMany({
        where,
        include: orderInclude,
        orderBy: [{ orderDate: "desc" }, { number: "desc" }],
        skip: (query.page - 1) * PURCHASE_PAGE_SIZE,
        take: PURCHASE_PAGE_SIZE,
      }),
    ]);
    return paged(rows.map(mapOrder), query.page, total);
  }
}

async function prepareOrder(transaction: Prisma.TransactionClient, input: PurchaseOrderInput) {
  const supplier = await transaction.supplier.findFirst({
    where: { id: input.supplierId, active: true },
    select: { id: true },
  });
  if (!supplier)
    throw new PurchasingRepositoryError("invalid-reference", "Select an active supplier.");
  if (input.lines.length === 0)
    throw new PurchasingRepositoryError(
      "invalid-reference",
      "At least one purchase-order line is required.",
    );
  const [items, units] = await Promise.all([
    transaction.item.findMany({
      where: {
        id: { in: [...new Set(input.lines.map((line) => line.itemId))] },
        active: true,
        itemType: { in: ["RAW_MATERIAL", "PACKAGING_MATERIAL"] },
      },
      include: { stockUnit: true },
    }),
    transaction.unit.findMany({ where: { active: true } }),
  ]);
  const supportedUnits = units.filter(
    (unit) =>
      isSupportedQuantityUnitCode(unit.code) &&
      supportedQuantityUnitDimension(unit.code) === unit.dimension,
  );
  const lines = input.lines.map((line, index) => prepareLine(line, index, items, supportedUnits));
  return { lines, totals: calculatePurchaseTotals(lines) };
}

function prepareLine(
  line: PurchaseOrderLineInput,
  index: number,
  items: readonly PurchasableItemRow[],
  units: readonly UnitRow[],
) {
  const item = items.find((candidate) => candidate.id === line.itemId);
  const unit = units.find((candidate) => candidate.id === line.unitId);
  if (!item || !unit || unit.dimension !== item.stockUnit.dimension) {
    throw new PurchasingRepositoryError(
      "invalid-reference",
      `Line ${index + 1} has an inactive or incompatible item/unit.`,
    );
  }
  const normalized = normalizeQuantity({ amount: line.quantity, unit }, units);
  const canonicalUnit = units.find((candidate) => candidate.code === normalized.unit.code);
  const enteredQuantity = new Decimal(line.quantity);
  const enteredRate = new Decimal(line.unitRate);
  if (
    !canonicalUnit ||
    enteredQuantity.decimalPlaces() > 6 ||
    enteredQuantity.gt("999999999999999999.999999") ||
    enteredRate.decimalPlaces() > 6 ||
    enteredRate.gt("999999999999999999.999999") ||
    new Decimal(normalized.amount).lte(0) ||
    new Decimal(normalized.amount).decimalPlaces() > 6 ||
    new Decimal(normalized.amount).gt("999999999999999999.999999")
  ) {
    throw new PurchasingRepositoryError(
      "invalid-reference",
      `Line ${index + 1} quantity is outside the supported range.`,
    );
  }
  const calculated = calculatePurchaseLine({
    quantity: line.quantity,
    unitRate: line.unitRate,
    discountPercent: line.discountPercent || "0",
    taxPercent: line.taxPercent || "0",
  });
  return {
    itemId: item.id,
    itemType: item.itemType,
    orderedQuantity: enteredQuantity.toFixed(),
    orderUnitId: unit.id,
    normalizedQuantity: normalized.amount,
    canonicalUnitId: canonicalUnit.id,
    unitRate: enteredRate.toFixed(),
    discountPercent: new Decimal(line.discountPercent || "0").toFixed(),
    taxPercent: new Decimal(line.taxPercent || "0").toFixed(),
    ...calculated,
    notes: line.notes ?? null,
  };
}

async function nextOrderNumber(transaction: Prisma.TransactionClient, year: number) {
  const sequence = await transaction.purchaseOrderSequence.upsert({
    where: { year },
    create: { year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return `PO-${year}-${String(sequence.nextValue - 1).padStart(6, "0")}`;
}

function mapOrder(row: OrderRow): PurchaseOrderRecord {
  return {
    id: row.id,
    number: row.number,
    supplierId: row.supplierId,
    supplierCode: row.supplier.code,
    supplierName: row.supplier.name,
    supplierContactPerson: row.supplier.contactPerson,
    supplierPhone: row.supplier.phone,
    supplierEmail: row.supplier.email,
    supplierAddress: row.supplier.address,
    supplierCity: row.supplier.city,
    orderDate: row.orderDate,
    expectedDeliveryDate: row.expectedDeliveryDate,
    status: row.status,
    supplierReference: row.supplierReference,
    notes: row.notes,
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
    lines: row.lines.map((line) => ({
      id: line.id,
      position: line.position,
      itemId: line.itemId,
      itemCode: line.item.code,
      itemName: line.item.name,
      itemType: line.itemType,
      orderedQuantity: line.orderedQuantity.toString(),
      orderUnitId: line.orderUnitId,
      orderUnitCode: line.orderUnit.code,
      orderUnitSymbol: line.orderUnit.symbol,
      normalizedQuantity: line.normalizedQuantity.toString(),
      canonicalUnitCode: line.canonicalUnit.code,
      canonicalUnitSymbol: line.canonicalUnit.symbol,
      unitRate: line.unitRate.toString(),
      discountPercent: line.discountPercent.toString(),
      taxPercent: line.taxPercent.toString(),
      grossAmount: line.grossAmount.toString(),
      discountAmount: line.discountAmount.toString(),
      taxAmount: line.taxAmount.toString(),
      netAmount: line.netAmount.toString(),
      notes: line.notes,
    })),
  };
}

function parseDate(value: string, label: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.valueOf()) ||
    dateInput(date) !== value
  )
    throw new PurchasingRepositoryError("invalid-reference", `${label} is invalid.`);
  return date;
}
function requireDeliveryDate(orderDate: Date, expected: Date | null) {
  if (expected && expected < orderDate)
    throw new PurchasingRepositoryError(
      "invalid-reference",
      "Expected delivery cannot be before the order date.",
    );
}
function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}
function paged<T>(records: readonly T[], page: number, total: number): PageResult<T> {
  return { records, page, total, pageCount: Math.max(1, Math.ceil(total / PURCHASE_PAGE_SIZE)) };
}

async function serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === 3) throw mapError(error, "purchase order");
    }
  }
  throw new PurchasingRepositoryError("conflict", "Purchase-order transaction conflict; retry.");
}

function mapError(error: unknown, entity: string) {
  if (error instanceof PurchasingRepositoryError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return new PurchasingRepositoryError(
        "conflict",
        `A ${entity} with this code or number already exists.`,
      );
    if (error.code === "P2025")
      return new PurchasingRepositoryError("not-found", `The ${entity} no longer exists.`);
    if (["P2003", "P2004"].includes(error.code))
      return new PurchasingRepositoryError(
        "invalid-reference",
        `The ${entity} conflicts with referenced data.`,
      );
  }
  return error instanceof Error
    ? error
    : new PurchasingRepositoryError("conflict", `${entity} could not be saved.`);
}
