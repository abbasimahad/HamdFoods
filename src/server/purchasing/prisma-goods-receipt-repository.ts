import "server-only";

import Decimal from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import type {
  PurchaseCatalogUnit,
  SupplierRecord,
} from "@/modules/purchasing/application/contracts";
import { PurchasingRepositoryError } from "@/modules/purchasing/application/contracts";
import type {
  GoodsReceiptInput,
  GoodsReceiptPage,
  GoodsReceiptQuery,
  GoodsReceiptRecord,
  GoodsReceiptRepository,
  PurchaseOrderProgress,
  QcDecisionInput,
  ReceivablePoLine,
  ReceivablePurchaseOrder,
} from "@/modules/purchasing/application/receiving-contracts";
import { PURCHASE_PAGE_SIZE } from "@/modules/purchasing/domain/purchasing";
import {
  isSupportedQuantityUnitCode,
  normalizeQuantity,
  supportedQuantityUnitDimension,
} from "@/modules/quantity/domain/quantity";
import { prisma } from "@/server/db/prisma";
import {
  postPurchaseReceiptInventory,
  postReceiptQcInventory,
} from "@/server/inventory/transactional-inventory-posting";
import { valueGoodsReceipt } from "@/server/costing/prisma-inventory-valuation-repository";
import {
  calculatePurchaseOrderFulfilment,
  updatePurchaseOrderFulfilmentStatus,
} from "./purchasing-fulfilment";
import { PrismaPurchaseReturnRepository } from "./prisma-purchase-return-repository";

const receiptInclude = {
  purchaseOrder: true,
  supplier: true,
  warehouse: true,
  receivedBy: true,
  postedBy: true,
  qcBy: true,
  cancelledBy: true,
  purchaseReturn: true,
  lines: {
    include: {
      purchaseOrderLine: { include: { item: true, canonicalUnit: true } },
      enteredUnit: true,
      inventoryLot: true,
      qcDecision: true,
    },
    orderBy: { position: "asc" as const },
  },
} satisfies Prisma.GoodsReceiptInclude;
type ReceiptRow = Prisma.GoodsReceiptGetPayload<{ include: typeof receiptInclude }>;
type InventoryLotRow = Prisma.InventoryLotGetPayload<Record<string, never>>;

export class PrismaGoodsReceiptRepository implements GoodsReceiptRepository {
  async listReceivablePurchaseOrders() {
    const orders = await prisma.purchaseOrder.findMany({
      where: { status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] } },
      include: {
        supplier: true,
        lines: { include: { item: true, canonicalUnit: true }, orderBy: { position: "asc" } },
      },
      orderBy: { number: "desc" },
      take: 250,
    });
    return Promise.all(orders.map((order) => mapReceivableOrder(prisma, order)));
  }

  async getReceivablePurchaseOrder(id: string) {
    const order = await prisma.purchaseOrder.findFirst({
      where: { id, status: { in: ["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED"] } },
      include: {
        supplier: true,
        lines: { include: { item: true, canonicalUnit: true }, orderBy: { position: "asc" } },
      },
    });
    return order ? mapReceivableOrder(prisma, order) : null;
  }

  async listReceivingWarehouses() {
    return prisma.warehouse.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      take: 250,
    });
  }
  async listReceivingUnits(): Promise<readonly PurchaseCatalogUnit[]> {
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
  async listReceivingSuppliers(): Promise<readonly SupplierRecord[]> {
    return prisma.supplier.findMany({ orderBy: { name: "asc" }, take: 500 });
  }
  async listReplacementTargets() {
    return new PrismaPurchaseReturnRepository().listReplacementTargets();
  }

  async createGoodsReceipt(input: GoodsReceiptInput) {
    return serializable(async (transaction) => {
      const prepared = await prepareDraft(transaction, input);
      const number = await nextNumber(transaction, prepared.receiptDate.getUTCFullYear());
      return (
        await transaction.goodsReceipt.create({
          data: {
            number,
            purchaseOrderId: input.purchaseOrderId,
            supplierId: prepared.supplierId,
            receiptDate: prepared.receiptDate,
            warehouseId: input.warehouseId,
            supplierDeliveryNumber: input.supplierDeliveryNumber ?? null,
            vehicleReference: input.vehicleReference ?? null,
            notes: input.notes ?? null,
            receivedByUserId: input.actorUserId,
            purpose: input.purpose ?? "PURCHASE",
            purchaseReturnId: input.purchaseReturnId ?? null,
            lines: {
              create: prepared.lines.map((line, index) => ({ ...line, position: index + 1 })),
            },
          },
        })
      ).id;
    });
  }

  async updateGoodsReceipt(input: GoodsReceiptInput & { id: string }) {
    return serializable(async (transaction) => {
      const current = await transaction.goodsReceipt.findUnique({
        where: { id: input.id },
        select: { status: true, purchaseOrderId: true, purpose: true, purchaseReturnId: true },
      });
      if (!current)
        throw new PurchasingRepositoryError("not-found", "Goods receipt no longer exists.");
      if (current.status !== "DRAFT")
        throw new PurchasingRepositoryError(
          "invalid-state",
          "Only draft goods receipts can be edited.",
        );
      if (current.purchaseOrderId !== input.purchaseOrderId)
        throw new PurchasingRepositoryError(
          "invalid-reference",
          "A draft goods receipt cannot change its purchase order.",
        );
      if (
        current.purpose !== (input.purpose ?? "PURCHASE") ||
        current.purchaseReturnId !== (input.purchaseReturnId ?? null)
      )
        throw new PurchasingRepositoryError(
          "invalid-reference",
          "A draft goods receipt cannot change its receipt purpose or purchase return.",
        );
      const prepared = await prepareDraft(transaction, input);
      await transaction.goodsReceiptLine.deleteMany({ where: { goodsReceiptId: input.id } });
      await transaction.goodsReceipt.update({
        where: { id: input.id },
        data: {
          receiptDate: prepared.receiptDate,
          warehouseId: input.warehouseId,
          supplierDeliveryNumber: input.supplierDeliveryNumber ?? null,
          vehicleReference: input.vehicleReference ?? null,
          notes: input.notes ?? null,
          lines: {
            create: prepared.lines.map((line, index) => ({ ...line, position: index + 1 })),
          },
        },
      });
      return input.id;
    });
  }

  async postGoodsReceipt(id: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const receipt = await transaction.goodsReceipt.findUnique({
        where: { id },
        include: {
          purchaseOrder: {
            include: { lines: { include: { item: true, canonicalUnit: true } }, supplier: true },
          },
          warehouse: true,
          lines: { orderBy: { position: "asc" } },
        },
      });
      if (!receipt)
        throw new PurchasingRepositoryError("not-found", "Goods receipt no longer exists.");
      if (receipt.status !== "DRAFT")
        throw new PurchasingRepositoryError(
          "invalid-state",
          "Only a draft goods receipt can be posted.",
        );
      if (
        (receipt.purpose === "PURCHASE" &&
          !["APPROVED", "PARTIALLY_RECEIVED"].includes(receipt.purchaseOrder.status)) ||
        (receipt.purpose === "SUPPLIER_REPLACEMENT" &&
          !["PARTIALLY_RECEIVED", "RECEIVED"].includes(receipt.purchaseOrder.status)) ||
        !receipt.warehouse.active
      )
        throw new PurchasingRepositoryError(
          "invalid-reference",
          "Purchase order or receiving warehouse is no longer eligible.",
        );
      if (receipt.purpose === "PURCHASE") {
        const openLines = await normalOpenLines(transaction, receipt.purchaseOrder.lines);
        for (const line of receipt.lines) {
          const open = openLines.get(line.purchaseOrderLineId) ?? new Decimal(0);
          if (new Decimal(line.normalizedQuantity.toString()).gt(open))
            throw new PurchasingRepositoryError(
              "invalid-state",
              "Receipt quantity exceeds the currently open normal PO quantity.",
            );
        }
      } else {
        if (!receipt.purchaseReturnId)
          throw new PurchasingRepositoryError(
            "invalid-reference",
            "Replacement receipt is missing its purchase return.",
          );
        const purchaseReturn = await transaction.purchaseReturn.findFirst({
          where: {
            id: receipt.purchaseReturnId,
            status: "AWAITING_REPLACEMENT",
            supplierId: receipt.supplierId,
            purchaseOrderId: receipt.purchaseOrderId,
          },
          include: { lines: true },
        });
        if (!purchaseReturn)
          throw new PurchasingRepositoryError(
            "invalid-reference",
            "Purchase return is no longer awaiting replacement.",
          );
        for (const line of receipt.lines) {
          const returnLine = purchaseReturn.lines.find(
            (candidate) =>
              candidate.id === line.purchaseReturnLineId &&
              candidate.purchaseOrderLineId === line.purchaseOrderLineId &&
              candidate.itemId === line.itemId &&
              candidate.replacementExpected,
          );
          if (!returnLine)
            throw new PurchasingRepositoryError(
              "invalid-reference",
              "Replacement line does not match the return obligation.",
            );
          const remaining = await replacementRemaining(
            transaction,
            returnLine.id,
            returnLine.normalizedQuantity.toString(),
          );
          if (new Decimal(line.normalizedQuantity.toString()).gt(remaining))
            throw new PurchasingRepositoryError(
              "invalid-state",
              "Replacement receipt exceeds the remaining supplier obligation.",
            );
        }
      }
      const lots: InventoryLotRow[] = [];
      for (const line of receipt.lines) {
        lots.push(
          await transaction.inventoryLot.create({
            data: {
              itemId: line.itemId,
              supplierId: receipt.supplierId,
              sourceGoodsReceiptId: receipt.id,
              sourceReceiptLineId: line.id,
              supplierLotNumber: line.supplierLotNumber,
              manufacturingDate: line.manufacturingDate,
              expiryDate: line.expiryDate,
            },
          }),
        );
      }
      await postPurchaseReceiptInventory(
        transaction,
        receipt.lines.map((line, index) => ({
          itemId: line.itemId,
          warehouseId: receipt.warehouseId,
          canonicalUnitId: line.canonicalUnitId,
          quantity: line.normalizedQuantity.toString(),
          inventoryLotId: lots[index]!.id,
          goodsReceiptId: receipt.id,
          goodsReceiptNumber: receipt.number,
          receiptLineId: line.id,
          actorUserId,
        })),
      );
      await valueGoodsReceipt(transaction, receipt.id, actorUserId);
      await transaction.goodsReceipt.update({
        where: { id },
        data: { status: "POSTED", postedByUserId: actorUserId, postedAt: new Date() },
      });
      await updatePurchaseOrderFulfilmentStatus(transaction, receipt.purchaseOrderId);
    });
  }

  async cancelGoodsReceipt(id: string, reason: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const updated = await transaction.goodsReceipt.updateMany({
        where: { id, status: "DRAFT" },
        data: {
          status: "CANCELLED",
          cancelledByUserId: actorUserId,
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
      });
      if (updated.count !== 1)
        throw new PurchasingRepositoryError(
          "invalid-state",
          "Only an existing draft goods receipt can be cancelled.",
        );
    });
  }

  async completeGoodsReceiptQc(
    id: string,
    decisions: readonly QcDecisionInput[],
    actorUserId: string,
  ) {
    await serializable(async (transaction) => {
      const receipt = await transaction.goodsReceipt.findUnique({
        where: { id },
        include: {
          lines: { include: { inventoryLot: true, qcDecision: true } },
          purchaseOrder: {
            include: { lines: { include: { item: true, canonicalUnit: true } }, supplier: true },
          },
        },
      });
      if (!receipt)
        throw new PurchasingRepositoryError("not-found", "Goods receipt no longer exists.");
      if (receipt.status !== "POSTED" || receipt.lines.some((line) => line.qcDecision))
        throw new PurchasingRepositoryError(
          "invalid-state",
          "QC is only available once for a posted goods receipt.",
        );
      if (
        decisions.length !== receipt.lines.length ||
        new Set(decisions.map((decision) => decision.goodsReceiptLineId)).size !==
          receipt.lines.length
      )
        throw new PurchasingRepositoryError(
          "invalid-reference",
          "QC must classify every receipt line exactly once.",
        );
      const inventoryCommands = [];
      for (const line of receipt.lines) {
        const decision = decisions.find((candidate) => candidate.goodsReceiptLineId === line.id);
        if (!decision || !line.inventoryLot)
          throw new PurchasingRepositoryError(
            "invalid-reference",
            "QC receipt line or inventory lot is invalid.",
          );
        const accepted = quantity(decision.acceptedQuantity, "Accepted quantity");
        const rejected = quantity(decision.rejectedQuantity, "Rejected quantity");
        if (!accepted.add(rejected).eq(line.normalizedQuantity.toString()))
          throw new PurchasingRepositoryError(
            "invalid-reference",
            "Accepted and rejected quantities must exactly equal received quantity.",
          );
        if (rejected.gt(0) && !decision.rejectionReason)
          throw new PurchasingRepositoryError(
            "invalid-reference",
            "Rejected quantity requires a rejection reason.",
          );
        if (rejected.isZero() && decision.rejectionReason)
          throw new PurchasingRepositoryError(
            "invalid-reference",
            "Do not select a rejection reason when rejected quantity is zero.",
          );
        await transaction.goodsReceiptQcDecision.create({
          data: {
            goodsReceiptLineId: line.id,
            acceptedQuantity: accepted.toFixed(),
            rejectedQuantity: rejected.toFixed(),
            rejectionReason: decision.rejectionReason ?? null,
            rejectionNotes: decision.rejectionNotes ?? null,
          },
        });
        inventoryCommands.push({
          itemId: line.itemId,
          warehouseId: receipt.warehouseId,
          canonicalUnitId: line.canonicalUnitId,
          quantity: line.normalizedQuantity.toString(),
          inventoryLotId: line.inventoryLot.id,
          goodsReceiptId: receipt.id,
          goodsReceiptNumber: receipt.number,
          receiptLineId: line.id,
          actorUserId,
          acceptedQuantity: accepted.toFixed(),
          rejectedQuantity: rejected.toFixed(),
          rejectionReason: decision.rejectionReason,
        });
      }
      await postReceiptQcInventory(transaction, inventoryCommands);
      await transaction.goodsReceipt.update({
        where: { id },
        data: { status: "QC_COMPLETED", qcByUserId: actorUserId, qcCompletedAt: new Date() },
      });
      if (receipt.purchaseReturnId)
        await completeReturnWhenSatisfied(transaction, receipt.purchaseReturnId);
      await updatePurchaseOrderFulfilmentStatus(transaction, receipt.purchaseOrderId);
    });
  }

  async getGoodsReceipt(id: string) {
    const row = await prisma.goodsReceipt.findUnique({ where: { id }, include: receiptInclude });
    return row ? mapReceipt(row) : null;
  }
  async listGoodsReceipts(query: GoodsReceiptQuery): Promise<GoodsReceiptPage> {
    const where = {
      ...(query.query
        ? {
            OR: [
              { number: { contains: query.query, mode: "insensitive" as const } },
              {
                purchaseOrder: { number: { contains: query.query, mode: "insensitive" as const } },
              },
            ],
          }
        : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            receiptDate: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lt: query.dateTo } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await prisma.$transaction([
      prisma.goodsReceipt.count({ where }),
      prisma.goodsReceipt.findMany({
        where,
        include: receiptInclude,
        orderBy: [{ receiptDate: "desc" }, { number: "desc" }],
        skip: (query.page - 1) * PURCHASE_PAGE_SIZE,
        take: PURCHASE_PAGE_SIZE,
      }),
    ]);
    return {
      records: rows.map(mapReceipt),
      page: query.page,
      pageCount: Math.max(1, Math.ceil(total / PURCHASE_PAGE_SIZE)),
      total,
    };
  }
  async getPurchaseOrderProgress(id: string): Promise<PurchaseOrderProgress> {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        lines: { include: { item: true, canonicalUnit: true }, orderBy: { position: "asc" } },
      },
    });
    if (!order) return { lines: [], goodsReceipts: [] };
    const [lines, receipts] = await Promise.all([
      progressLines(prisma, order.lines),
      prisma.goodsReceipt.findMany({
        where: { purchaseOrderId: id },
        include: { warehouse: true },
        orderBy: { receiptDate: "desc" },
      }),
    ]);
    return {
      lines,
      goodsReceipts: receipts.map((receipt) => ({
        id: receipt.id,
        number: receipt.number,
        status: receipt.status,
        receiptDate: receipt.receiptDate,
        warehouseName: receipt.warehouse.name,
      })),
    };
  }
}

type PoRow = Prisma.PurchaseOrderGetPayload<{
  include: { supplier: true; lines: { include: { item: true; canonicalUnit: true } } };
}>;
type PoLineRow = PoRow["lines"][number];
async function mapReceivableOrder(
  client: Prisma.TransactionClient | typeof prisma,
  order: PoRow,
): Promise<ReceivablePurchaseOrder> {
  return {
    id: order.id,
    number: order.number,
    supplierId: order.supplierId,
    supplierCode: order.supplier.code,
    supplierName: order.supplier.name,
    status: order.status as "APPROVED" | "PARTIALLY_RECEIVED",
    lines: await progressLines(client, order.lines),
  };
}

async function progressLines(
  client: Prisma.TransactionClient | typeof prisma,
  poLines: readonly PoLineRow[],
): Promise<ReceivablePoLine[]> {
  const progress = await calculatePurchaseOrderFulfilment(client, poLines);
  return poLines.map((line) => {
    const row = progress.find((candidate) => candidate.purchaseOrderLineId === line.id)!;
    return {
      id: line.id,
      itemId: line.itemId,
      itemCode: line.item.code,
      itemName: line.item.name,
      itemType: line.itemType as "RAW_MATERIAL" | "PACKAGING_MATERIAL",
      orderedQuantity: row.orderedQuantity,
      canonicalUnitId: line.canonicalUnitId,
      canonicalUnitCode: line.canonicalUnit.code,
      canonicalUnitSymbol: line.canonicalUnit.symbol,
      canonicalUnitDimension: line.canonicalUnit.dimension,
      pendingQcQuantity: row.pendingQcQuantity,
      acceptedQuantity: row.netAcceptedQuantity,
      returnedAcceptedQuantity: row.returnedAcceptedQuantity,
      rejectedQuantity: row.rejectedQuantity,
      remainingToReceive: row.remainingToReceive,
      remainingToFulfil: row.remainingToFulfil,
    };
  });
}

async function prepareDraft(transaction: Prisma.TransactionClient, input: GoodsReceiptInput) {
  const receiptDate = dateTime(input.receiptDate, "Receipt date");
  const [order, warehouse, units] = await Promise.all([
    transaction.purchaseOrder.findFirst({
      where: {
        id: input.purchaseOrderId,
        status: {
          in:
            input.purpose === "SUPPLIER_REPLACEMENT"
              ? ["PARTIALLY_RECEIVED", "RECEIVED"]
              : ["APPROVED", "PARTIALLY_RECEIVED"],
        },
      },
      include: { lines: { include: { item: true, canonicalUnit: true } } },
    }),
    transaction.warehouse.findFirst({ where: { id: input.warehouseId, active: true } }),
    transaction.unit.findMany({ where: { active: true } }),
  ]);
  if (!order || !warehouse)
    throw new PurchasingRepositoryError(
      "invalid-reference",
      "Select an eligible purchase order and active warehouse.",
    );
  let purchaseReturn = null;
  if (input.purpose === "SUPPLIER_REPLACEMENT") {
    if (!input.purchaseReturnId)
      throw new PurchasingRepositoryError(
        "invalid-reference",
        "Select a purchase return awaiting replacement.",
      );
    purchaseReturn = await transaction.purchaseReturn.findFirst({
      where: {
        id: input.purchaseReturnId,
        status: "AWAITING_REPLACEMENT",
        supplierId: order.supplierId,
        purchaseOrderId: order.id,
      },
      include: { lines: true },
    });
    if (!purchaseReturn)
      throw new PurchasingRepositoryError(
        "invalid-reference",
        "Select a purchase return awaiting replacement.",
      );
  }
  if ((input.purpose ?? "PURCHASE") === "PURCHASE" && input.purchaseReturnId)
    throw new PurchasingRepositoryError(
      "invalid-reference",
      "A normal receipt cannot reference a purchase return.",
    );
  if (new Set(input.lines.map((line) => line.purchaseOrderLineId)).size !== input.lines.length)
    throw new PurchasingRepositoryError(
      "invalid-reference",
      "A PO line can appear only once per goods receipt.",
    );
  const supported = units.filter(
    (unit) =>
      isSupportedQuantityUnitCode(unit.code) &&
      supportedQuantityUnitDimension(unit.code) === unit.dimension,
  );
  const lines = input.lines.map((line, index) => {
    const poLine = order.lines.find((candidate) => candidate.id === line.purchaseOrderLineId);
    const returnLine = purchaseReturn?.lines.find(
      (candidate) =>
        candidate.id === line.purchaseReturnLineId &&
        candidate.purchaseOrderLineId === line.purchaseOrderLineId &&
        candidate.itemId === poLine?.itemId &&
        candidate.replacementExpected,
    );
    const enteredUnit = supported.find((candidate) => candidate.id === line.unitId);
    if (
      !poLine ||
      !poLine.item.active ||
      !enteredUnit ||
      (purchaseReturn && !returnLine) ||
      enteredUnit.dimension !== poLine.canonicalUnit.dimension
    )
      throw new PurchasingRepositoryError(
        "invalid-reference",
        `Receipt line ${index + 1} has an inactive or incompatible reference.`,
      );
    const normalized = normalizeQuantity({ amount: line.quantity, unit: enteredUnit }, supported);
    const exactEntered = quantity(line.quantity, "Received quantity");
    const exactNormalized = quantity(normalized.amount, "Normalized received quantity");
    if (exactEntered.lte(0) || exactNormalized.lte(0))
      throw new PurchasingRepositoryError(
        "invalid-reference",
        "Received quantity must be greater than zero.",
      );
    const manufacturingDate = line.manufacturingDate
      ? dateOnly(line.manufacturingDate, "Manufacturing date")
      : null;
    const expiryDate = line.expiryDate ? dateOnly(line.expiryDate, "Expiry date") : null;
    if (manufacturingDate && expiryDate && expiryDate < manufacturingDate)
      throw new PurchasingRepositoryError(
        "invalid-reference",
        "Expiry date cannot precede manufacturing date.",
      );
    return {
      purchaseOrderLineId: poLine.id,
      itemId: poLine.itemId,
      enteredQuantity: exactEntered.toFixed(),
      enteredUnitId: enteredUnit.id,
      normalizedQuantity: exactNormalized.toFixed(),
      canonicalUnitId: poLine.canonicalUnitId,
      supplierLotNumber: line.supplierLotNumber ?? null,
      manufacturingDate,
      expiryDate,
      notes: line.notes ?? null,
      purchaseReturnLineId: returnLine?.id ?? null,
    };
  });
  return { supplierId: order.supplierId, receiptDate, lines };
}

function mapReceipt(row: ReceiptRow): GoodsReceiptRecord {
  return {
    id: row.id,
    number: row.number,
    purchaseOrderId: row.purchaseOrderId,
    purchaseOrderNumber: row.purchaseOrder.number,
    supplierId: row.supplierId,
    supplierCode: row.supplier.code,
    supplierName: row.supplier.name,
    receiptDate: row.receiptDate,
    warehouseId: row.warehouseId,
    warehouseCode: row.warehouse.code,
    warehouseName: row.warehouse.name,
    supplierDeliveryNumber: row.supplierDeliveryNumber,
    vehicleReference: row.vehicleReference,
    notes: row.notes,
    status: row.status,
    purpose: row.purpose,
    purchaseReturnId: row.purchaseReturnId,
    purchaseReturnNumber: row.purchaseReturn?.number ?? null,
    receivedByName: row.receivedBy.name,
    postedByName: row.postedBy?.name ?? null,
    postedAt: row.postedAt,
    qcByName: row.qcBy?.name ?? null,
    qcCompletedAt: row.qcCompletedAt,
    cancelledByName: row.cancelledBy?.name ?? null,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt,
    lines: row.lines.map((line) => ({
      id: line.id,
      position: line.position,
      purchaseOrderLineId: line.purchaseOrderLineId,
      itemId: line.itemId,
      itemCode: line.purchaseOrderLine.item.code,
      itemName: line.purchaseOrderLine.item.name,
      orderedQuantity: line.purchaseOrderLine.normalizedQuantity.toString(),
      enteredQuantity: line.enteredQuantity.toString(),
      enteredUnitId: line.enteredUnitId,
      enteredUnitCode: line.enteredUnit.code,
      enteredUnitSymbol: line.enteredUnit.symbol,
      normalizedQuantity: line.normalizedQuantity.toString(),
      canonicalUnitId: line.canonicalUnitId,
      canonicalUnitCode: line.purchaseOrderLine.canonicalUnit.code,
      canonicalUnitSymbol: line.purchaseOrderLine.canonicalUnit.symbol,
      supplierLotNumber: line.supplierLotNumber,
      manufacturingDate: line.manufacturingDate,
      expiryDate: line.expiryDate,
      notes: line.notes,
      inventoryLotId: line.inventoryLot?.id ?? null,
      acceptedQuantity: line.qcDecision?.acceptedQuantity.toString() ?? "0",
      rejectedQuantity: line.qcDecision?.rejectedQuantity.toString() ?? "0",
      rejectionReason: line.qcDecision?.rejectionReason ?? null,
      rejectionNotes: line.qcDecision?.rejectionNotes ?? null,
      purchaseReturnLineId: line.purchaseReturnLineId,
    })),
  };
}

async function normalOpenLines(
  transaction: Prisma.TransactionClient,
  poLines: readonly PoLineRow[],
) {
  const receiptLines = await transaction.goodsReceiptLine.findMany({
    where: {
      purchaseOrderLineId: { in: poLines.map((line) => line.id) },
      goodsReceipt: { purpose: "PURCHASE", status: { in: ["POSTED", "QC_COMPLETED"] } },
    },
    include: { goodsReceipt: { select: { status: true } }, qcDecision: true },
  });
  return new Map(
    poLines.map((line) => {
      const related = receiptLines.filter((row) => row.purchaseOrderLineId === line.id);
      const accepted = related.reduce(
        (total, row) => total.add(row.qcDecision?.acceptedQuantity.toString() ?? "0"),
        new Decimal(0),
      );
      const pending = related
        .filter((row) => row.goodsReceipt.status === "POSTED")
        .reduce((total, row) => total.add(row.normalizedQuantity.toString()), new Decimal(0));
      return [
        line.id,
        Decimal.max(new Decimal(line.normalizedQuantity.toString()).sub(accepted).sub(pending), 0),
      ] as const;
    }),
  );
}

async function replacementRemaining(
  transaction: Prisma.TransactionClient,
  returnLineId: string,
  required: string,
) {
  const lines = await transaction.goodsReceiptLine.findMany({
    where: {
      purchaseReturnLineId: returnLineId,
      goodsReceipt: { status: { in: ["POSTED", "QC_COMPLETED"] } },
    },
    include: { goodsReceipt: { select: { status: true } }, qcDecision: true },
  });
  const satisfiedOrPending = lines.reduce(
    (total, line) =>
      total.add(
        line.goodsReceipt.status === "POSTED"
          ? line.normalizedQuantity.toString()
          : (line.qcDecision?.acceptedQuantity.toString() ?? "0"),
      ),
    new Decimal(0),
  );
  return Decimal.max(new Decimal(required).sub(satisfiedOrPending), 0);
}

async function completeReturnWhenSatisfied(
  transaction: Prisma.TransactionClient,
  purchaseReturnId: string,
) {
  const row = await transaction.purchaseReturn.findUnique({
    where: { id: purchaseReturnId },
    include: {
      lines: {
        include: {
          replacementGoodsReceiptLines: { include: { qcDecision: true, goodsReceipt: true } },
        },
      },
    },
  });
  if (!row || row.status !== "AWAITING_REPLACEMENT") return;
  const complete = row.lines
    .filter((line) => line.replacementExpected)
    .every((line) => {
      const accepted = line.replacementGoodsReceiptLines
        .filter((receiptLine) => receiptLine.goodsReceipt.status === "QC_COMPLETED")
        .reduce(
          (total, receiptLine) =>
            total.add(receiptLine.qcDecision?.acceptedQuantity.toString() ?? "0"),
          new Decimal(0),
        );
      return accepted.gte(line.normalizedQuantity.toString());
    });
  if (complete)
    await transaction.purchaseReturn.update({
      where: { id: purchaseReturnId },
      data: { status: "COMPLETED" },
    });
}

async function nextNumber(transaction: Prisma.TransactionClient, year: number) {
  const sequence = await transaction.goodsReceiptSequence.upsert({
    where: { year },
    create: { year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return `GRN-${year}-${String(sequence.nextValue - 1).padStart(6, "0")}`;
}
function quantity(value: string, label: string) {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new PurchasingRepositoryError("invalid-reference", `${label} is invalid.`);
  }
  if (
    !parsed.isFinite() ||
    parsed.lt(0) ||
    parsed.decimalPlaces() > 6 ||
    parsed.gt("999999999999999999.999999")
  )
    throw new PurchasingRepositoryError(
      "invalid-reference",
      `${label} is outside the supported range.`,
    );
  return parsed;
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
function dateTime(value: string, label: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()))
    throw new PurchasingRepositoryError("invalid-reference", `${label} is invalid.`);
  return date;
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
  throw new PurchasingRepositoryError("conflict", "Receiving transaction conflict; retry.");
}
function mapError(error: unknown) {
  if (error instanceof PurchasingRepositoryError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return new PurchasingRepositoryError(
        "conflict",
        "This receipt or posting was already recorded.",
      );
    if (["P2003", "P2004"].includes(error.code))
      return new PurchasingRepositoryError(
        "invalid-reference",
        "Receiving data conflicts with protected references.",
      );
  }
  return error instanceof Error
    ? error
    : new PurchasingRepositoryError("conflict", "Receiving operation failed.");
}
