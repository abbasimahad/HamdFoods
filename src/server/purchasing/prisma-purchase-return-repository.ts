import "server-only";

import Decimal from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import {
  PurchasingRepositoryError,
  type PurchaseCatalogUnit,
  type SupplierRecord,
} from "@/modules/purchasing/application/contracts";
import type {
  EligibleReturnSource,
  PurchaseReturnInput,
  PurchaseReturnPage,
  PurchaseReturnQuery,
  PurchaseReturnRecord,
  PurchaseReturnRepository,
  PurchasedLotOption,
  PurchasedMaterialQuarantineInput,
  ReplacementTarget,
} from "@/modules/purchasing/application/return-contracts";
import { PURCHASE_PAGE_SIZE } from "@/modules/purchasing/domain/purchasing";
import {
  isSupportedQuantityUnitCode,
  normalizeQuantity,
  supportedQuantityUnitDimension,
} from "@/modules/quantity/domain/quantity";
import { prisma } from "@/server/db/prisma";
import { recordAuditEvent } from "@/server/audit/audit-event";
import {
  postPurchaseReturnInventory,
  quarantinePurchasedMaterialInventory,
} from "@/server/inventory/transactional-inventory-posting";
import { valuePurchaseReturn } from "@/server/costing/prisma-inventory-valuation-repository";
import { postPurchaseReturnAccounting } from "@/server/accounting/transactional-accounting-posting";
import { updatePurchaseOrderFulfilmentStatus } from "./purchasing-fulfilment";

const returnInclude = {
  supplier: true,
  purchaseOrder: true,
  originalGoodsReceipt: true,
  sourceWarehouse: true,
  createdBy: true,
  postedBy: true,
  cancelledBy: true,
  lines: {
    include: {
      item: true,
      inventoryLot: true,
      enteredUnit: true,
      canonicalUnit: true,
      replacementGoodsReceiptLines: {
        include: { goodsReceipt: true, qcDecision: true },
      },
    },
    orderBy: { position: "asc" as const },
  },
  replacementGoodsReceipts: { orderBy: { receiptDate: "desc" as const } },
} satisfies Prisma.PurchaseReturnInclude;
type ReturnRow = Prisma.PurchaseReturnGetPayload<{ include: typeof returnInclude }>;
type Client = Prisma.TransactionClient | typeof prisma;

export class PrismaPurchaseReturnRepository implements PurchaseReturnRepository {
  async listEligibleReturnSources() {
    return eligibleReturnSources(prisma);
  }
  async listPurchasedLotsWithAvailableStock() {
    return purchasedLotsWithAvailableStock(prisma);
  }
  async listReturnUnits(): Promise<readonly PurchaseCatalogUnit[]> {
    const rows = await prisma.unit.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    return rows.filter(
      (unit) =>
        isSupportedQuantityUnitCode(unit.code) &&
        supportedQuantityUnitDimension(unit.code) === unit.dimension,
    );
  }
  async listReturnSuppliers(): Promise<readonly SupplierRecord[]> {
    return prisma.supplier.findMany({ orderBy: { name: "asc" } });
  }
  async createPurchaseReturn(input: PurchaseReturnInput) {
    return serializable(async (transaction) => {
      const prepared = await prepareReturn(transaction, input);
      const year = prepared.returnDate.getUTCFullYear();
      const number = await nextNumber(transaction, year);
      return (
        await transaction.purchaseReturn.create({
          data: {
            number,
            supplierId: prepared.header.supplierId,
            purchaseOrderId: prepared.header.purchaseOrderId,
            originalGoodsReceiptId: prepared.header.goodsReceiptId,
            sourceWarehouseId: prepared.header.warehouseId,
            returnDate: prepared.returnDate,
            reasonNotes: input.reasonNotes ?? null,
            replacementExpected: prepared.lines.some((line) => line.replacementExpected),
            supplierReturnReference: input.supplierReturnReference ?? null,
            createdByUserId: input.actorUserId,
            lines: {
              create: prepared.lines.map((line, index) => ({ ...line, position: index + 1 })),
            },
          },
        })
      ).id;
    });
  }
  async updatePurchaseReturn(input: PurchaseReturnInput & { id: string }) {
    return serializable(async (transaction) => {
      const existing = await transaction.purchaseReturn.findUnique({ where: { id: input.id } });
      if (!existing || existing.status !== "DRAFT")
        throw new PurchasingRepositoryError(
          "invalid-state",
          "Only a draft purchase return can be edited.",
        );
      const prepared = await prepareReturn(transaction, input);
      await transaction.purchaseReturn.update({
        where: { id: input.id },
        data: {
          supplierId: prepared.header.supplierId,
          purchaseOrderId: prepared.header.purchaseOrderId,
          originalGoodsReceiptId: prepared.header.goodsReceiptId,
          sourceWarehouseId: prepared.header.warehouseId,
          returnDate: prepared.returnDate,
          reasonNotes: input.reasonNotes ?? null,
          replacementExpected: prepared.lines.some((line) => line.replacementExpected),
          supplierReturnReference: input.supplierReturnReference ?? null,
          lines: {
            deleteMany: {},
            create: prepared.lines.map((line, index) => ({ ...line, position: index + 1 })),
          },
        },
      });
      return input.id;
    });
  }
  async postPurchaseReturn(id: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const row = await transaction.purchaseReturn.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!row || row.status !== "DRAFT")
        throw new PurchasingRepositoryError(
          "invalid-state",
          "Only a draft purchase return can be posted.",
        );
      const sources = await eligibleReturnSources(transaction);
      for (const line of row.lines) {
        const key =
          line.source === "QC_REJECTED"
            ? `QC:${line.originalGoodsReceiptLineId}`
            : `HOLD:${line.purchasedMaterialQuarantineId}`;
        const source = sources.find((candidate) => candidate.key === key);
        if (
          !source ||
          source.inventoryLotId !== line.inventoryLotId ||
          source.warehouseId !== row.sourceWarehouseId ||
          new Decimal(source.eligibleQuantity).lt(line.normalizedQuantity.toString())
        ) {
          throw new PurchasingRepositoryError(
            "invalid-state",
            "Return quantity is no longer available in the selected quarantine source.",
          );
        }
      }
      await transaction.purchaseReturn.update({
        where: { id },
        data: { status: "POSTED", postedByUserId: actorUserId, postedAt: new Date() },
      });
      await postPurchaseReturnInventory(
        transaction,
        row.lines.map((line) => ({
          purchaseReturnId: row.id,
          purchaseReturnNumber: row.number,
          purchaseReturnLineId: line.id,
          itemId: line.itemId,
          warehouseId: row.sourceWarehouseId,
          canonicalUnitId: line.canonicalUnitId,
          quantity: line.normalizedQuantity.toString(),
          inventoryLotId: line.inventoryLotId,
          sourceGoodsReceiptId: row.originalGoodsReceiptId,
          actorUserId,
        })),
      );
      await valuePurchaseReturn(transaction, row.id, actorUserId);
      await transaction.purchaseReturn.update({
        where: { id },
        data: { status: row.replacementExpected ? "AWAITING_REPLACEMENT" : "COMPLETED" },
      });
      await postPurchaseReturnAccounting(transaction, row.id, actorUserId);
      await updatePurchaseOrderFulfilmentStatus(transaction, row.purchaseOrderId);
      const finalStatus = row.replacementExpected ? "AWAITING_REPLACEMENT" : "COMPLETED";
      await recordAuditEvent(transaction, {
        actorUserId,
        action: "POST",
        entityType: "PURCHASE_RETURN",
        entityId: row.id,
        entityReference: row.number,
        module: "purchasing",
        description: `Posted purchase return ${row.number}.`,
        metadata: { lineCount: row.lines.length, replacementExpected: row.replacementExpected },
        beforeSnapshot: { status: row.status },
        afterSnapshot: { status: finalStatus },
        related: { entityType: "PURCHASE_ORDER", entityId: row.purchaseOrderId },
        controlEvent: true,
      });
    });
  }
  async cancelPurchaseReturn(id: string, reason: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const purchaseReturn = await transaction.purchaseReturn.findUnique({
        where: { id },
        select: { number: true, status: true },
      });
      const result = await transaction.purchaseReturn.updateMany({
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
          "Only an existing draft purchase return can be cancelled.",
        );
      await recordAuditEvent(transaction, {
        actorUserId,
        action: "CANCEL",
        entityType: "PURCHASE_RETURN",
        entityId: id,
        entityReference: purchaseReturn?.number ?? null,
        module: "purchasing",
        description: `Cancelled draft purchase return ${purchaseReturn?.number ?? id}.`,
        reasonCode: "OPERATIONAL_CORRECTION",
        reason,
        beforeSnapshot: { status: purchaseReturn?.status ?? "DRAFT" },
        afterSnapshot: { status: "CANCELLED" },
        controlEvent: true,
      });
    });
  }
  async quarantinePurchasedMaterial(input: PurchasedMaterialQuarantineInput) {
    return serializable(async (transaction) => {
      const options = await purchasedLotsWithAvailableStock(transaction);
      const option = options.find(
        (row) =>
          row.inventoryLotId === input.inventoryLotId && row.warehouseId === input.warehouseId,
      );
      const units = await transaction.unit.findMany({ where: { active: true } });
      const enteredUnit = units.find(
        (unit) => unit.id === input.unitId && isSupportedQuantityUnitCode(unit.code),
      );
      if (
        !option ||
        !enteredUnit ||
        enteredUnit.dimension !== supportedQuantityUnitDimension(option.canonicalUnitCode)
      ) {
        throw new PurchasingRepositoryError(
          "invalid-reference",
          "Select an eligible purchased lot and compatible active unit.",
        );
      }
      const normalized = normalizeQuantity(
        { amount: input.quantity, unit: enteredUnit },
        units.filter((unit) => isSupportedQuantityUnitCode(unit.code)),
      );
      const amount = positive(normalized.amount, "Quarantine quantity");
      if (amount.gt(option.availableQuantity))
        throw new PurchasingRepositoryError(
          "invalid-state",
          "Quarantine quantity exceeds available lot stock.",
        );
      const record = await transaction.purchasedMaterialQuarantine.create({
        data: {
          itemId: option.itemId,
          warehouseId: option.warehouseId,
          inventoryLotId: option.inventoryLotId,
          quantity: amount.toFixed(),
          canonicalUnitId: option.canonicalUnitId,
          reason: input.reason,
          notes: input.notes ?? null,
          createdByUserId: input.actorUserId,
        },
      });
      await quarantinePurchasedMaterialInventory(transaction, {
        operationId: record.id,
        itemId: option.itemId,
        warehouseId: option.warehouseId,
        canonicalUnitId: option.canonicalUnitId,
        quantity: amount.toFixed(),
        inventoryLotId: option.inventoryLotId,
        sourceGoodsReceiptId: option.goodsReceiptId,
        reason: `Purchased material quarantined: ${input.reason}${input.notes ? ` - ${input.notes}` : ""}`,
        actorUserId: input.actorUserId,
      });
      await recordAuditEvent(transaction, {
        actorUserId: input.actorUserId,
        action: "ADJUST",
        entityType: "INVENTORY_TRANSFER",
        entityId: record.id,
        module: "purchasing",
        description: "Moved purchased material from available stock to quarantine.",
        reasonCode: "QUALITY_FAILURE",
        reason: input.reason,
        metadata: {
          itemId: option.itemId,
          warehouseId: option.warehouseId,
          inventoryLotId: option.inventoryLotId,
          quantity: amount.toFixed(6),
        },
        related: { entityType: "GRN", entityId: option.goodsReceiptId },
        controlEvent: true,
      });
      return record.id;
    });
  }
  async getPurchaseReturn(id: string) {
    const row = await prisma.purchaseReturn.findUnique({ where: { id }, include: returnInclude });
    return row ? mapReturn(row) : null;
  }
  async listPurchaseReturns(query: PurchaseReturnQuery): Promise<PurchaseReturnPage> {
    const where = {
      ...(query.query
        ? {
            OR: [
              { number: { contains: query.query, mode: "insensitive" as const } },
              { supplier: { name: { contains: query.query, mode: "insensitive" as const } } },
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
            returnDate: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lt: query.dateTo } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await prisma.$transaction([
      prisma.purchaseReturn.count({ where }),
      prisma.purchaseReturn.findMany({
        where,
        include: returnInclude,
        orderBy: [{ returnDate: "desc" }, { number: "desc" }],
        skip: (query.page - 1) * PURCHASE_PAGE_SIZE,
        take: PURCHASE_PAGE_SIZE,
      }),
    ]);
    return {
      records: rows.map(mapReturn),
      page: query.page,
      pageCount: Math.max(1, Math.ceil(total / PURCHASE_PAGE_SIZE)),
      total,
    };
  }
  async listReplacementTargets(): Promise<readonly ReplacementTarget[]> {
    const rows = await prisma.purchaseReturn.findMany({
      where: { status: "AWAITING_REPLACEMENT" },
      include: returnInclude,
      orderBy: { returnDate: "asc" },
    });
    return rows
      .map((row) => {
        const mapped = mapReturn(row);
        return {
          purchaseReturnId: row.id,
          purchaseReturnNumber: row.number,
          purchaseOrderId: row.purchaseOrderId,
          purchaseOrderNumber: row.purchaseOrder.number,
          supplierId: row.supplierId,
          supplierName: row.supplier.name,
          lines: mapped.lines
            .filter(
              (line) =>
                line.replacementExpected && new Decimal(line.replacementRemainingQuantity).gt(0),
            )
            .map((line) => {
              const source = row.lines.find((candidate) => candidate.id === line.id)!;
              return {
                purchaseReturnLineId: source.id,
                purchaseOrderLineId: source.purchaseOrderLineId,
                itemId: source.itemId,
                itemCode: source.item.code,
                itemName: source.item.name,
                canonicalUnitId: source.canonicalUnitId,
                canonicalUnitCode: source.canonicalUnit.code,
                canonicalUnitSymbol: source.canonicalUnit.symbol,
                canonicalUnitDimension: source.canonicalUnit.dimension,
                remainingQuantity: line.replacementRemainingQuantity,
              };
            }),
        };
      })
      .filter((target) => target.lines.length > 0);
  }
}

async function prepareReturn(transaction: Prisma.TransactionClient, input: PurchaseReturnInput) {
  const sources = await eligibleReturnSources(transaction);
  const units = await transaction.unit.findMany({ where: { active: true } });
  const selected = input.lines.map((line, index) => {
    const source = sources.find((candidate) => candidate.key === line.sourceKey);
    const unit = units.find(
      (candidate) => candidate.id === line.unitId && isSupportedQuantityUnitCode(candidate.code),
    );
    if (
      !source ||
      !unit ||
      unit.dimension !== supportedQuantityUnitDimension(source.canonicalUnitCode)
    )
      throw new PurchasingRepositoryError(
        "invalid-reference",
        `Return line ${index + 1} has an invalid source or unit.`,
      );
    const normalized = normalizeQuantity(
      { amount: line.quantity, unit },
      units.filter((candidate) => isSupportedQuantityUnitCode(candidate.code)),
    );
    const amount = positive(normalized.amount, "Return quantity");
    if (amount.gt(source.eligibleQuantity))
      throw new PurchasingRepositoryError(
        "invalid-state",
        `Return line ${index + 1} exceeds eligible quarantine quantity.`,
      );
    return { source, line, unit, amount };
  });
  const header = selected[0]!.source;
  if (
    new Set(input.lines.map((line) => line.sourceKey)).size !== input.lines.length ||
    selected.some(
      ({ source }) =>
        source.supplierId !== header.supplierId ||
        source.purchaseOrderId !== header.purchaseOrderId ||
        source.goodsReceiptId !== header.goodsReceiptId ||
        source.warehouseId !== header.warehouseId,
    )
  ) {
    throw new PurchasingRepositoryError(
      "invalid-reference",
      "One return must use unique sources from one supplier, PO, GRN, and warehouse.",
    );
  }
  return {
    header,
    returnDate: dateOnly(input.returnDate),
    lines: selected.map(({ source, line, unit, amount }) => ({
      itemId: source.itemId,
      purchaseOrderLineId: source.purchaseOrderLineId,
      originalGoodsReceiptLineId: source.goodsReceiptLineId,
      inventoryLotId: source.inventoryLotId,
      source: source.source,
      purchasedMaterialQuarantineId: source.purchasedMaterialQuarantineId,
      enteredQuantity: positive(line.quantity, "Entered return quantity").toFixed(),
      enteredUnitId: unit.id,
      normalizedQuantity: amount.toFixed(),
      canonicalUnitId: source.canonicalUnitId,
      reason: line.reason,
      replacementExpected: line.replacementExpected,
      notes: line.notes ?? null,
    })),
  };
}

async function eligibleReturnSources(client: Client): Promise<readonly EligibleReturnSource[]> {
  const [qcLines, holds] = await Promise.all([
    client.goodsReceiptLine.findMany({
      where: {
        goodsReceipt: { status: "QC_COMPLETED" },
        qcDecision: { rejectedQuantity: { gt: 0 } },
        inventoryLot: { isNot: null },
      },
      include: {
        goodsReceipt: { include: { supplier: true, purchaseOrder: true, warehouse: true } },
        purchaseOrderLine: { include: { item: true, canonicalUnit: true } },
        inventoryLot: true,
        qcDecision: true,
      },
    }),
    client.purchasedMaterialQuarantine.findMany({
      include: {
        warehouse: true,
        inventoryLot: {
          include: {
            supplier: true,
            sourceGoodsReceipt: { include: { purchaseOrder: true } },
            sourceReceiptLine: {
              include: { purchaseOrderLine: { include: { item: true, canonicalUnit: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const results: EligibleReturnSource[] = [];
  for (const line of qcLines) {
    const returned = await returnedFromSource(client, {
      originalGoodsReceiptLineId: line.id,
      source: "QC_REJECTED",
    });
    const entitlement = new Decimal(line.qcDecision!.rejectedQuantity.toString()).sub(returned);
    const balance = await lotBalance(
      client,
      line.itemId,
      line.goodsReceipt.warehouseId,
      "QUARANTINE",
      line.inventoryLot!.id,
    );
    const eligible = Decimal.min(entitlement, balance);
    if (eligible.gt(0))
      results.push(
        sourceRecord(
          `QC:${line.id}`,
          "QC_REJECTED",
          null,
          line.goodsReceipt,
          line,
          line.inventoryLot!,
          eligible,
        ),
      );
  }
  for (const hold of holds) {
    const returned = await returnedFromSource(client, {
      purchasedMaterialQuarantineId: hold.id,
      source: "POST_ACCEPTANCE_DEFECT",
    });
    const entitlement = new Decimal(hold.quantity.toString()).sub(returned);
    const balance = await lotBalance(
      client,
      hold.itemId,
      hold.warehouseId,
      "QUARANTINE",
      hold.inventoryLotId,
    );
    const eligible = Decimal.min(entitlement, balance);
    if (eligible.gt(0)) {
      const receipt = {
        ...hold.inventoryLot.sourceGoodsReceipt,
        supplier: hold.inventoryLot.supplier,
        warehouse: hold.warehouse,
      };
      results.push(
        sourceRecord(
          `HOLD:${hold.id}`,
          "POST_ACCEPTANCE_DEFECT",
          hold.id,
          receipt,
          hold.inventoryLot.sourceReceiptLine,
          hold.inventoryLot,
          eligible,
        ),
      );
    }
  }
  return results;
}

async function purchasedLotsWithAvailableStock(
  client: Client,
): Promise<readonly PurchasedLotOption[]> {
  const lines = await client.goodsReceiptLine.findMany({
    where: {
      goodsReceipt: { status: "QC_COMPLETED" },
      qcDecision: { acceptedQuantity: { gt: 0 } },
      inventoryLot: { isNot: null },
    },
    include: {
      goodsReceipt: { include: { supplier: true, purchaseOrder: true, warehouse: true } },
      purchaseOrderLine: { include: { item: true, canonicalUnit: true } },
      inventoryLot: true,
    },
  });
  const result: PurchasedLotOption[] = [];
  for (const line of lines) {
    const available = await lotBalance(
      client,
      line.itemId,
      line.goodsReceipt.warehouseId,
      "AVAILABLE",
      line.inventoryLot!.id,
    );
    if (available.gt(0)) {
      const source = sourceRecord(
        "",
        "POST_ACCEPTANCE_DEFECT",
        null,
        line.goodsReceipt,
        line,
        line.inventoryLot!,
        available,
      );
      const {
        key: _key,
        source: _source,
        purchasedMaterialQuarantineId: _hold,
        eligibleQuantity: _eligible,
        ...option
      } = source;
      void _key;
      void _source;
      void _hold;
      void _eligible;
      result.push({ ...option, availableQuantity: available.toFixed() });
    }
  }
  return result;
}

type SourceReceipt = {
  id: string;
  number: string;
  supplierId: string;
  purchaseOrderId: string;
  warehouseId: string;
  supplier: { code: string; name: string };
  purchaseOrder: { number: string };
  warehouse: { code: string; name: string };
};
type SourceLine = {
  id: string;
  purchaseOrderLineId: string;
  itemId: string;
  canonicalUnitId: string;
  purchaseOrderLine: {
    item: { code: string; name: string };
    canonicalUnit: { code: string; symbol: string };
  };
};
type SourceLot = { id: string; supplierLotNumber: string | null };
function sourceRecord(
  key: string,
  source: "QC_REJECTED" | "POST_ACCEPTANCE_DEFECT",
  purchasedMaterialQuarantineId: string | null,
  receipt: SourceReceipt,
  line: SourceLine,
  lot: SourceLot,
  eligible: Decimal,
): EligibleReturnSource {
  return {
    key,
    source,
    purchasedMaterialQuarantineId,
    supplierId: receipt.supplierId,
    supplierCode: receipt.supplier.code,
    supplierName: receipt.supplier.name,
    purchaseOrderId: receipt.purchaseOrderId,
    purchaseOrderNumber: receipt.purchaseOrder.number,
    purchaseOrderLineId: line.purchaseOrderLineId,
    goodsReceiptId: receipt.id,
    goodsReceiptNumber: receipt.number,
    goodsReceiptLineId: line.id,
    warehouseId: receipt.warehouseId,
    warehouseCode: receipt.warehouse.code,
    warehouseName: receipt.warehouse.name,
    inventoryLotId: lot.id,
    supplierLotNumber: lot.supplierLotNumber,
    itemId: line.itemId,
    itemCode: line.purchaseOrderLine.item.code,
    itemName: line.purchaseOrderLine.item.name,
    canonicalUnitId: line.canonicalUnitId,
    canonicalUnitCode: line.purchaseOrderLine.canonicalUnit.code,
    canonicalUnitSymbol: line.purchaseOrderLine.canonicalUnit.symbol,
    eligibleQuantity: eligible.toFixed(),
  };
}
async function returnedFromSource(
  client: Client,
  where: {
    source: "QC_REJECTED" | "POST_ACCEPTANCE_DEFECT";
    originalGoodsReceiptLineId?: string;
    purchasedMaterialQuarantineId?: string;
  },
) {
  const result = await client.purchaseReturnLine.aggregate({
    where: {
      ...where,
      purchaseReturn: { status: { in: ["POSTED", "AWAITING_REPLACEMENT", "COMPLETED"] } },
    },
    _sum: { normalizedQuantity: true },
  });
  return result._sum.normalizedQuantity?.toString() ?? "0";
}
async function lotBalance(
  client: Client,
  itemId: string,
  warehouseId: string,
  status: "AVAILABLE" | "QUARANTINE",
  inventoryLotId: string,
) {
  const result = await client.inventoryMovement.aggregate({
    where: { itemId, warehouseId, status, inventoryLotId },
    _sum: { quantity: true },
  });
  return new Decimal(result._sum.quantity?.toString() ?? "0");
}
function mapReturn(row: ReturnRow): PurchaseReturnRecord {
  return {
    id: row.id,
    number: row.number,
    supplierId: row.supplierId,
    supplierCode: row.supplier.code,
    supplierName: row.supplier.name,
    purchaseOrderId: row.purchaseOrderId,
    purchaseOrderNumber: row.purchaseOrder.number,
    originalGoodsReceiptId: row.originalGoodsReceiptId,
    originalGoodsReceiptNumber: row.originalGoodsReceipt.number,
    returnDate: row.returnDate,
    sourceWarehouseId: row.sourceWarehouseId,
    sourceWarehouseName: row.sourceWarehouse.name,
    status: row.status,
    reasonNotes: row.reasonNotes,
    replacementExpected: row.replacementExpected,
    supplierReturnReference: row.supplierReturnReference,
    createdByName: row.createdBy.name,
    postedByName: row.postedBy?.name ?? null,
    postedAt: row.postedAt,
    cancelledByName: row.cancelledBy?.name ?? null,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt,
    lines: row.lines.map((line) => {
      const received = sum(
        line.replacementGoodsReceiptLines
          .filter((receiptLine) =>
            ["POSTED", "QC_COMPLETED"].includes(receiptLine.goodsReceipt.status),
          )
          .map((receiptLine) => receiptLine.normalizedQuantity.toString()),
      );
      const accepted = sum(
        line.replacementGoodsReceiptLines.map(
          (receiptLine) => receiptLine.qcDecision?.acceptedQuantity.toString() ?? "0",
        ),
      );
      const required = line.replacementExpected ? line.normalizedQuantity.toString() : "0";
      return {
        id: line.id,
        sourceKey:
          line.source === "QC_REJECTED"
            ? `QC:${line.originalGoodsReceiptLineId}`
            : `HOLD:${line.purchasedMaterialQuarantineId}`,
        itemCode: line.item.code,
        itemName: line.item.name,
        source: line.source,
        supplierLotNumber: line.inventoryLot.supplierLotNumber,
        enteredQuantity: line.enteredQuantity.toString(),
        enteredUnitId: line.enteredUnitId,
        enteredUnitSymbol: line.enteredUnit.symbol,
        normalizedQuantity: line.normalizedQuantity.toString(),
        canonicalUnitSymbol: line.canonicalUnit.symbol,
        reason: line.reason,
        replacementExpected: line.replacementExpected,
        replacementReceivedQuantity: received,
        replacementAcceptedQuantity: accepted,
        replacementRemainingQuantity: Decimal.max(new Decimal(required).sub(accepted), 0).toFixed(),
        notes: line.notes,
      };
    }),
    replacementGoodsReceipts: row.replacementGoodsReceipts.map((receipt) => ({
      id: receipt.id,
      number: receipt.number,
      status: receipt.status,
      receiptDate: receipt.receiptDate,
    })),
  };
}
async function nextNumber(transaction: Prisma.TransactionClient, year: number) {
  const sequence = await transaction.purchaseReturnSequence.upsert({
    where: { year },
    create: { year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return `PR-${year}-${String(sequence.nextValue - 1).padStart(6, "0")}`;
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
  return amount;
}
function dateOnly(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new PurchasingRepositoryError("invalid-reference", "Return date is invalid.");
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
  throw new PurchasingRepositoryError("conflict", "Purchase return transaction conflict; retry.");
}
function mapError(error: unknown) {
  if (error instanceof PurchasingRepositoryError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return new PurchasingRepositoryError(
        "conflict",
        "This purchase return operation was already recorded.",
      );
    if (["P2003", "P2004"].includes(error.code))
      return new PurchasingRepositoryError(
        "invalid-reference",
        "Purchase return data conflicts with protected references.",
      );
  }
  return error instanceof Error
    ? error
    : new PurchasingRepositoryError("conflict", "Purchase return operation failed.");
}
