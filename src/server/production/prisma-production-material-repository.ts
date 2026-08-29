import "server-only";

import Decimal from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import { InventoryRepositoryError } from "@/modules/inventory/application/contracts";
import type {
  BatchMaterialView,
  EligibleMaterialLot,
  MaterialTransactionInput,
  MaterialTransactionRecord,
  MaterialTransactionType,
  ProductionMaterialRepository,
} from "@/modules/production/application/material-contracts";
import { ProductionMaterialRepositoryError } from "@/modules/production/application/material-contracts";
import { reconcileMaterial } from "@/modules/production/domain/material-reconciliation";
import { normalizeQuantity } from "@/modules/quantity/domain/quantity";
import { prisma } from "@/server/db/prisma";
import { postProductionMaterialInventory } from "@/server/inventory/transactional-inventory-posting";
import { valueProductionConsumption } from "@/server/costing/prisma-inventory-valuation-repository";
import { PrismaRecipeRepository } from "./prisma-recipe-repository";

const transactionInclude = {
  productionBatch: true,
  createdBy: true,
  postedBy: true,
  cancelledBy: true,
  lines: {
    include: {
      item: true,
      sourceWarehouse: true,
      destinationWarehouse: true,
      inventoryLot: { include: { sourceGoodsReceipt: true } },
      enteredUnit: true,
      canonicalUnit: true,
    },
    orderBy: { position: "asc" as const },
  },
} satisfies Prisma.ProductionMaterialTransactionInclude;
type TransactionRow = Prisma.ProductionMaterialTransactionGetPayload<{
  include: typeof transactionInclude;
}>;

export class PrismaProductionMaterialRepository implements ProductionMaterialRepository {
  async listUnits() {
    return new PrismaRecipeRepository().listRecipeUnits();
  }

  async listWarehouses() {
    return prisma.warehouse.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true, active: true },
      orderBy: { name: "asc" },
      take: 500,
    });
  }

  async createTransaction(input: MaterialTransactionInput) {
    const prepared = await prepareLine(input);
    return serializable(async (transaction) => {
      await validateActor(transaction, input.actorUserId);
      const number = await nextTransactionNumber(transaction, input.transactionType);
      return (
        await transaction.productionMaterialTransaction.create({
          data: {
            transactionNumber: number,
            productionBatchId: input.productionBatchId,
            materialType: "RAW_MATERIAL",
            transactionType: input.transactionType,
            transactionDate: transactionDate(input.transactionDate),
            notes: input.notes ?? null,
            createdByUserId: input.actorUserId,
            lines: { create: prepared },
          },
        })
      ).id;
    });
  }

  async updateTransaction(input: MaterialTransactionInput & { id: string }) {
    const prepared = await prepareLine(input);
    return serializable(async (transaction) => {
      const current = await transaction.productionMaterialTransaction.findUnique({
        where: { id: input.id },
      });
      if (!current || current.materialType !== "RAW_MATERIAL" || current.status !== "DRAFT")
        throw new ProductionMaterialRepositoryError(
          "invalid-state",
          "Only a DRAFT material transaction can be edited.",
        );
      if (
        current.productionBatchId !== input.productionBatchId ||
        current.transactionType !== input.transactionType
      )
        throw new ProductionMaterialRepositoryError(
          "invalid-state",
          "A draft cannot change its batch or transaction type.",
        );
      await validateActor(transaction, input.actorUserId);
      await transaction.productionMaterialTransactionLine.deleteMany({
        where: { transactionId: input.id },
      });
      await transaction.productionMaterialTransaction.update({
        where: { id: input.id },
        data: {
          transactionDate: transactionDate(input.transactionDate),
          notes: input.notes ?? null,
          lines: { create: prepared },
        },
      });
      return input.id;
    });
  }

  async postTransaction(id: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const row = await transaction.productionMaterialTransaction.findUnique({
        where: { id },
        include: { productionBatch: true, lines: true },
      });
      if (
        !row ||
        row.materialType !== "RAW_MATERIAL" ||
        row.transactionType === "DAMAGE" ||
        row.status !== "DRAFT" ||
        row.lines.length !== 1
      )
        throw new ProductionMaterialRepositoryError(
          "invalid-state",
          "Only a complete DRAFT material transaction can be posted.",
        );
      const allowed =
        row.transactionType === "ISSUE"
          ? ["RELEASED", "IN_PROGRESS"].includes(row.productionBatch.status)
          : row.productionBatch.status === "IN_PROGRESS";
      if (!allowed)
        throw new ProductionMaterialRepositoryError(
          "invalid-state",
          row.transactionType === "ISSUE"
            ? "Material issue requires a RELEASED or IN_PROGRESS batch."
            : "Material return and consumption require an IN_PROGRESS batch.",
        );
      await validateActor(transaction, actorUserId);
      const line = row.lines[0]!;
      await postProductionMaterialInventory(transaction, {
        materialType: "RAW_MATERIAL",
        operation: row.transactionType,
        transactionId: row.id,
        transactionNumber: row.transactionNumber,
        transactionLineId: line.id,
        productionBatchId: row.productionBatchId,
        batchNumber: row.productionBatch.batchNumber,
        itemId: line.itemId,
        custodyWarehouseId: line.sourceWarehouseId,
        destinationWarehouseId: line.destinationWarehouseId ?? undefined,
        canonicalUnitId: line.canonicalUnitId,
        quantity: line.normalizedQuantity.toString(),
        inventoryLotId: line.inventoryLotId,
        reason:
          line.notes ??
          row.notes ??
          `${row.transactionType.toLowerCase()} for batch ${row.productionBatch.batchNumber}.`,
        actorUserId,
      });
      await valueProductionConsumption(transaction, row.id, actorUserId);
      if (row.transactionType === "ISSUE" && row.productionBatch.status === "RELEASED") {
        await transaction.productionBatch.update({
          where: { id: row.productionBatchId },
          data: { status: "IN_PROGRESS" },
        });
      }
      await transaction.productionMaterialTransaction.update({
        where: { id },
        data: { status: "POSTED", postedByUserId: actorUserId, postedAt: new Date() },
      });
    });
  }

  async cancelTransaction(id: string, actorUserId: string, reason: string) {
    await serializable(async (transaction) => {
      const current = await transaction.productionMaterialTransaction.findUnique({ where: { id } });
      if (!current || current.materialType !== "RAW_MATERIAL" || current.status !== "DRAFT")
        throw new ProductionMaterialRepositoryError(
          "invalid-state",
          "Only an unposted DRAFT material transaction can be cancelled.",
        );
      await validateActor(transaction, actorUserId);
      await transaction.productionMaterialTransaction.update({
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

  async getTransaction(id: string) {
    const row = await prisma.productionMaterialTransaction.findFirst({
      where: { id, materialType: "RAW_MATERIAL" },
      include: transactionInclude,
    });
    return row ? mapTransaction(row) : null;
  }

  async getBatchMaterialView(productionBatchId: string): Promise<BatchMaterialView | null> {
    const batch = await prisma.productionBatch.findUnique({
      where: { id: productionBatchId },
      include: {
        finishedGood: true,
        rawMaterialWarehouse: true,
        materialRequirements: {
          include: { item: true, canonicalUnit: true },
          orderBy: { sequence: "asc" },
        },
        materialTransactions: {
          where: { materialType: "RAW_MATERIAL" },
          include: transactionInclude,
          orderBy: [{ transactionDate: "desc" }, { transactionNumber: "desc" }],
        },
      },
    });
    if (!batch) return null;
    const itemIds = batch.materialRequirements.map((line) => line.itemId);
    const [available, issued, returned, consumed, availableLots, heldLots] = await Promise.all([
      aggregateByItem({
        itemId: { in: itemIds },
        warehouseId: batch.rawMaterialWarehouseId,
        status: "AVAILABLE",
      }),
      aggregateByItem({
        productionBatchId,
        itemId: { in: itemIds },
        status: "IN_PRODUCTION",
        movementType: "PRODUCTION_ISSUE",
        quantity: { gt: 0 },
      }),
      aggregateByItem({
        productionBatchId,
        itemId: { in: itemIds },
        status: "AVAILABLE",
        movementType: "PRODUCTION_RETURN",
        quantity: { gt: 0 },
      }),
      aggregateByItem(
        {
          productionBatchId,
          itemId: { in: itemIds },
          status: "IN_PRODUCTION",
          movementType: "PRODUCTION_CONSUMPTION",
          quantity: { lt: 0 },
        },
        true,
      ),
      listLotBalances(batch.rawMaterialWarehouseId, itemIds, "AVAILABLE"),
      listLotBalances(batch.rawMaterialWarehouseId, itemIds, "IN_PRODUCTION", productionBatchId),
    ]);
    return {
      productionBatchId,
      batchNumber: batch.batchNumber,
      batchStatus: batch.status,
      finishedGoodCode: batch.finishedGood.code,
      finishedGoodName: batch.finishedGood.name,
      rawMaterialWarehouseId: batch.rawMaterialWarehouseId,
      rawMaterialWarehouseName: batch.rawMaterialWarehouse.name,
      requirements: batch.materialRequirements.map((line) => {
        const cumulativeIssued = issued.get(line.itemId) ?? "0";
        const cumulativeReturned = returned.get(line.itemId) ?? "0";
        const cumulativeConsumed = consumed.get(line.itemId) ?? "0";
        const reconciliation = reconcileMaterial({
          planned: line.plannedNormalizedQuantity.toString(),
          issued: cumulativeIssued,
          returned: cumulativeReturned,
          consumed: cumulativeConsumed,
        });
        return {
          requirementId: line.id,
          itemId: line.itemId,
          itemCode: line.item.code,
          itemName: line.item.name,
          plannedQuantity: line.plannedNormalizedQuantity.toString(),
          allowancePercent: line.allowancePercent.toString(),
          recommendedIssueQuantity: line.recommendedIssueQuantity.toString(),
          availableQuantity: available.get(line.itemId) ?? "0",
          cumulativeIssued,
          remainingPlannedQuantity: Decimal.max(
            new Decimal(line.plannedNormalizedQuantity).sub(cumulativeIssued),
            0,
          ).toFixed(),
          cumulativeReturned,
          cumulativeConsumed,
          ...reconciliation,
          canonicalUnitId: line.canonicalUnitId,
          canonicalUnitCode: line.canonicalUnit.code,
          canonicalUnitSymbol: line.canonicalUnit.symbol,
          canonicalUnitDimension: line.canonicalUnitDimension,
        };
      }),
      availableLots,
      heldLots,
      transactions: batch.materialTransactions.map(mapTransaction),
    };
  }
}

async function prepareLine(input: MaterialTransactionInput) {
  const [requirement, units, lot, destination] = await Promise.all([
    prisma.productionMaterialRequirement.findFirst({
      where: { id: input.batchRequirementId, productionBatchId: input.productionBatchId },
      include: { productionBatch: true, item: true },
    }),
    new PrismaRecipeRepository().listRecipeUnits(),
    prisma.inventoryLot.findUnique({ where: { id: input.inventoryLotId } }),
    input.destinationWarehouseId
      ? prisma.warehouse.findFirst({ where: { id: input.destinationWarehouseId, active: true } })
      : null,
  ]);
  if (!requirement || !requirement.item.active || !lot || lot.itemId !== requirement.itemId)
    throw new ProductionMaterialRepositoryError(
      "invalid-reference",
      "Select a valid active batch raw-material requirement and matching inventory lot.",
    );
  const batchAllowed =
    input.transactionType === "ISSUE"
      ? ["RELEASED", "IN_PROGRESS"].includes(requirement.productionBatch.status)
      : requirement.productionBatch.status === "IN_PROGRESS";
  if (!batchAllowed)
    throw new ProductionMaterialRepositoryError(
      "invalid-state",
      input.transactionType === "ISSUE"
        ? "Material issue requires a RELEASED or IN_PROGRESS batch."
        : "Material return and consumption require an IN_PROGRESS batch.",
    );
  if (input.transactionType === "RETURN" && !destination)
    throw new ProductionMaterialRepositoryError(
      "invalid-reference",
      "Select an active return destination warehouse.",
    );
  const unit = units.find((candidate) => candidate.id === input.unitId);
  if (!unit || unit.dimension !== requirement.canonicalUnitDimension)
    throw new ProductionMaterialRepositoryError(
      "invalid-reference",
      "Select a compatible active quantity unit.",
    );
  const normalized = normalizeQuantity({ amount: input.quantity, unit }, units);
  const canonical = units.find(
    (candidate) =>
      candidate.code === normalized.unit.code && candidate.id === requirement.canonicalUnitId,
  );
  if (!canonical || new Decimal(normalized.amount).lte(0))
    throw new ProductionMaterialRepositoryError(
      "invalid-reference",
      "Material quantity must be positive and match the requirement stock unit.",
    );
  return {
    position: 1,
    batchRequirementId: requirement.id,
    itemId: requirement.itemId,
    sourceWarehouseId: requirement.productionBatch.rawMaterialWarehouseId,
    destinationWarehouseId:
      input.transactionType === "ISSUE"
        ? requirement.productionBatch.rawMaterialWarehouseId
        : input.transactionType === "RETURN"
          ? input.destinationWarehouseId!
          : null,
    inventoryLotId: lot.id,
    enteredQuantity: input.quantity,
    enteredUnitId: unit.id,
    enteredUnitDimension: unit.dimension,
    normalizedQuantity: normalized.amount,
    canonicalUnitId: canonical.id,
    canonicalUnitDimension: canonical.dimension,
    notes: input.notes ?? null,
  };
}

async function listLotBalances(
  warehouseId: string,
  itemIds: readonly string[],
  status: "AVAILABLE" | "IN_PRODUCTION",
  productionBatchId?: string,
): Promise<EligibleMaterialLot[]> {
  if (itemIds.length === 0) return [];
  const groups = await prisma.inventoryMovement.groupBy({
    by: ["itemId", "inventoryLotId", "canonicalUnitId"],
    where: {
      itemId: { in: [...itemIds] },
      warehouseId,
      status,
      inventoryLotId: { not: null },
      ...(productionBatchId ? { productionBatchId } : {}),
    },
    _sum: { quantity: true },
  });
  const positive = groups.filter((group) =>
    new Decimal(group._sum?.quantity?.toString() ?? 0).gt(0),
  );
  const lots = await prisma.inventoryLot.findMany({
    where: { id: { in: positive.map((group) => group.inventoryLotId!) } },
    include: {
      item: true,
      supplier: true,
      sourceGoodsReceipt: true,
    },
  });
  const units = await prisma.unit.findMany({
    where: { id: { in: positive.map((group) => group.canonicalUnitId) } },
  });
  return positive.map((group) => {
    const lot = lots.find((candidate) => candidate.id === group.inventoryLotId)!;
    const unit = units.find((candidate) => candidate.id === group.canonicalUnitId)!;
    return {
      id: lot.id,
      itemId: lot.itemId,
      itemCode: lot.item.code,
      itemName: lot.item.name,
      warehouseId,
      supplierName: lot.supplier.name,
      supplierLotNumber: lot.supplierLotNumber,
      goodsReceiptNumber: lot.sourceGoodsReceipt.number,
      manufacturingDate: lot.manufacturingDate,
      expiryDate: lot.expiryDate,
      availableQuantity: group._sum?.quantity?.toString() ?? "0",
      canonicalUnitId: unit.id,
      canonicalUnitCode: unit.code,
      canonicalUnitSymbol: unit.symbol,
      canonicalUnitDimension: unit.dimension,
    };
  });
}

async function aggregateByItem(where: Prisma.InventoryMovementWhereInput, absolute = false) {
  const rows = await prisma.inventoryMovement.groupBy({
    by: ["itemId"],
    where,
    _sum: { quantity: true },
  });
  return new Map(
    rows.map((row) => {
      const value = new Decimal(row._sum.quantity?.toString() ?? 0);
      return [row.itemId, (absolute ? value.abs() : value).toFixed()];
    }),
  );
}

function mapTransaction(row: TransactionRow): MaterialTransactionRecord {
  const line = row.lines[0];
  if (!line || !line.batchRequirementId || row.transactionType === "DAMAGE")
    throw new ProductionMaterialRepositoryError(
      "invalid-state",
      "Material transaction has no line.",
    );
  return {
    id: row.id,
    transactionNumber: row.transactionNumber,
    productionBatchId: row.productionBatchId,
    batchNumber: row.productionBatch.batchNumber,
    transactionType: row.transactionType,
    transactionDate: row.transactionDate,
    status: row.status,
    notes: row.notes,
    createdByName: row.createdBy.name,
    postedByName: row.postedBy?.name ?? null,
    postedAt: row.postedAt,
    cancelledByName: row.cancelledBy?.name ?? null,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt,
    line: {
      id: line.id,
      batchRequirementId: line.batchRequirementId,
      itemId: line.itemId,
      itemCode: line.item.code,
      itemName: line.item.name,
      sourceWarehouseId: line.sourceWarehouseId,
      sourceWarehouseName: line.sourceWarehouse.name,
      destinationWarehouseId: line.destinationWarehouseId,
      destinationWarehouseName: line.destinationWarehouse?.name ?? null,
      inventoryLotId: line.inventoryLotId,
      supplierLotNumber: line.inventoryLot.supplierLotNumber,
      goodsReceiptNumber: line.inventoryLot.sourceGoodsReceipt.number,
      enteredQuantity: line.enteredQuantity.toString(),
      enteredUnitId: line.enteredUnitId,
      enteredUnitCode: line.enteredUnit.code,
      enteredUnitSymbol: line.enteredUnit.symbol,
      normalizedQuantity: line.normalizedQuantity.toString(),
      canonicalUnitId: line.canonicalUnitId,
      canonicalUnitCode: line.canonicalUnit.code,
      canonicalUnitSymbol: line.canonicalUnit.symbol,
      canonicalUnitDimension: line.canonicalUnitDimension,
      notes: line.notes,
    },
  };
}

async function nextTransactionNumber(
  transaction: Prisma.TransactionClient,
  type: MaterialTransactionType,
) {
  const year = new Date().getUTCFullYear();
  const sequence = await transaction.productionMaterialTransactionSequence.upsert({
    where: {
      materialType_transactionType_year: {
        materialType: "RAW_MATERIAL",
        transactionType: type,
        year,
      },
    },
    create: { materialType: "RAW_MATERIAL", transactionType: type, year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  const prefix = type === "ISSUE" ? "MI" : type === "RETURN" ? "MR" : "MC";
  const value = sequence.nextValue - 1;
  if (value > 999999)
    throw new ProductionMaterialRepositoryError(
      "conflict",
      "Annual material sequence is exhausted.",
    );
  return `${prefix}-${year}-${String(value).padStart(6, "0")}`;
}

function transactionDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()))
    throw new ProductionMaterialRepositoryError(
      "invalid-reference",
      "Transaction date is invalid.",
    );
  return date;
}

async function validateActor(transaction: Prisma.TransactionClient, actorUserId: string) {
  if ((await transaction.user.count({ where: { id: actorUserId, active: true } })) !== 1)
    throw new ProductionMaterialRepositoryError("invalid-reference", "Acting user is inactive.");
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
  throw new ProductionMaterialRepositoryError("conflict", "Material transaction conflict; retry.");
}

function mapError(error: unknown) {
  if (error instanceof ProductionMaterialRepositoryError) return error;
  if (error instanceof InventoryRepositoryError)
    return new ProductionMaterialRepositoryError(
      error.reason === "reference" ? "invalid-reference" : error.reason,
      error.message,
    );
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return new ProductionMaterialRepositoryError(
        "conflict",
        "Material transaction number conflicts.",
      );
    if (["P2003", "P2004"].includes(error.code))
      return new ProductionMaterialRepositoryError(
        "invalid-reference",
        "Material transaction conflicts with protected production or inventory references.",
      );
  }
  return error instanceof Error
    ? error
    : new ProductionMaterialRepositoryError("conflict", "Material transaction failed.");
}
