import "server-only";

import Decimal from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import { InventoryRepositoryError } from "@/modules/inventory/application/contracts";
import type { EligibleMaterialLot } from "@/modules/production/application/material-contracts";
import {
  ProductionPackagingRepositoryError,
  type BatchPackagingView,
  type PackagingTransactionInput,
  type PackagingTransactionRecord,
  type PackagingTransactionType,
  type ProductionPackagingRepository,
} from "@/modules/production/application/packaging-contracts";
import { reconcilePackaging } from "@/modules/production/domain/packaging-reconciliation";
import { normalizeQuantity } from "@/modules/quantity/domain/quantity";
import { prisma } from "@/server/db/prisma";
import { postProductionMaterialInventory } from "@/server/inventory/transactional-inventory-posting";
import { valueProductionConsumption } from "@/server/costing/prisma-inventory-valuation-repository";
import { PrismaRecipeRepository } from "./prisma-recipe-repository";

const transactionInclude = {
  productionBatch: true,
  createdBy: true,
  postedBy: true,
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

export class PrismaProductionPackagingRepository implements ProductionPackagingRepository {
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

  async createTransaction(input: PackagingTransactionInput) {
    const line = await prepareLine(input);
    return serializable(async (transaction) => {
      await validateActor(transaction, input.actorUserId);
      const number = await nextNumber(transaction, input.transactionType);
      return (
        await transaction.productionMaterialTransaction.create({
          data: {
            transactionNumber: number,
            productionBatchId: input.productionBatchId,
            materialType: "PACKAGING_MATERIAL",
            transactionType: input.transactionType,
            damageReason: input.damageReason ?? null,
            transactionDate: parseDate(input.transactionDate),
            notes: input.notes ?? null,
            createdByUserId: input.actorUserId,
            lines: { create: line },
          },
        })
      ).id;
    });
  }

  async updateTransaction(input: PackagingTransactionInput & { id: string }) {
    const line = await prepareLine(input);
    return serializable(async (transaction) => {
      const current = await transaction.productionMaterialTransaction.findUnique({
        where: { id: input.id },
      });
      if (
        !current ||
        current.materialType !== "PACKAGING_MATERIAL" ||
        current.status !== "DRAFT" ||
        current.productionBatchId !== input.productionBatchId ||
        current.transactionType !== input.transactionType
      )
        throw new ProductionPackagingRepositoryError(
          "invalid-state",
          "Only a packaging DRAFT may be edited without changing its batch or operation.",
        );
      await validateActor(transaction, input.actorUserId);
      await transaction.productionMaterialTransactionLine.deleteMany({
        where: { transactionId: input.id },
      });
      await transaction.productionMaterialTransaction.update({
        where: { id: input.id },
        data: {
          transactionDate: parseDate(input.transactionDate),
          damageReason: input.damageReason ?? null,
          notes: input.notes ?? null,
          lines: { create: line },
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
        row.materialType !== "PACKAGING_MATERIAL" ||
        row.status !== "DRAFT" ||
        row.productionBatch.status !== "IN_PROGRESS" ||
        row.lines.length !== 1
      )
        throw new ProductionPackagingRepositoryError(
          "invalid-state",
          "A complete packaging DRAFT on an IN_PROGRESS batch is required.",
        );
      await validateActor(transaction, actorUserId);
      const line = row.lines[0]!;
      await postProductionMaterialInventory(transaction, {
        materialType: "PACKAGING_MATERIAL",
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
          row.transactionType === "DAMAGE"
            ? `${row.damageReason}: ${line.notes ?? row.notes ?? "Packaging damage recorded."}`
            : (line.notes ??
              row.notes ??
              `${row.transactionType.toLowerCase()} for ${row.productionBatch.batchNumber}.`),
        actorUserId,
      });
      await valueProductionConsumption(transaction, row.id, actorUserId);
      await transaction.productionMaterialTransaction.update({
        where: { id },
        data: { status: "POSTED", postedByUserId: actorUserId, postedAt: new Date() },
      });
    });
  }

  async cancelTransaction(id: string, actorUserId: string, reason: string) {
    await serializable(async (transaction) => {
      const current = await transaction.productionMaterialTransaction.findUnique({ where: { id } });
      if (!current || current.materialType !== "PACKAGING_MATERIAL" || current.status !== "DRAFT")
        throw new ProductionPackagingRepositoryError(
          "invalid-state",
          "Only an unposted packaging DRAFT may be cancelled.",
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
      where: { id, materialType: "PACKAGING_MATERIAL" },
      include: transactionInclude,
    });
    return row ? mapTransaction(row) : null;
  }

  async getBatchPackagingView(productionBatchId: string): Promise<BatchPackagingView | null> {
    const batch = await prisma.productionBatch.findUnique({
      where: { id: productionBatchId },
      include: {
        finishedGood: true,
        packagingWarehouse: true,
        packagingRequirements: {
          include: { item: true, canonicalUnit: true },
          orderBy: { sequence: "asc" },
        },
        materialTransactions: {
          where: { materialType: "PACKAGING_MATERIAL" },
          include: transactionInclude,
          orderBy: [{ transactionDate: "desc" }, { transactionNumber: "desc" }],
        },
      },
    });
    if (!batch) return null;
    const itemIds = batch.packagingRequirements.map((line) => line.itemId);
    const [available, issued, returned, consumed, damaged, availableLots, heldLots] =
      await Promise.all([
        aggregate({
          itemId: { in: itemIds },
          warehouseId: batch.packagingWarehouseId,
          status: "AVAILABLE",
        }),
        aggregate({
          productionBatchId,
          itemId: { in: itemIds },
          status: "IN_PRODUCTION",
          movementType: "PACKAGING_ISSUE",
          quantity: { gt: 0 },
        }),
        aggregate({
          productionBatchId,
          itemId: { in: itemIds },
          status: "AVAILABLE",
          movementType: "PACKAGING_RETURN",
          quantity: { gt: 0 },
        }),
        aggregate(
          {
            productionBatchId,
            itemId: { in: itemIds },
            status: "IN_PRODUCTION",
            movementType: "PACKAGING_CONSUMPTION",
            quantity: { lt: 0 },
          },
          true,
        ),
        aggregate({
          productionBatchId,
          itemId: { in: itemIds },
          status: "DAMAGED",
          movementType: "PACKAGING_DAMAGE",
          quantity: { gt: 0 },
        }),
        listLotBalances(batch.packagingWarehouseId, itemIds, "AVAILABLE"),
        listLotBalances(batch.packagingWarehouseId, itemIds, "IN_PRODUCTION", productionBatchId),
      ]);
    return {
      productionBatchId,
      batchNumber: batch.batchNumber,
      batchStatus: batch.status,
      finishedGoodCode: batch.finishedGood.code,
      finishedGoodName: batch.finishedGood.name,
      packagingWarehouseId: batch.packagingWarehouseId,
      packagingWarehouseName: batch.packagingWarehouse.name,
      requirements: batch.packagingRequirements.map((line) => {
        const cumulativeIssued = issued.get(line.itemId) ?? "0";
        const cumulativeReturned = returned.get(line.itemId) ?? "0";
        const cumulativeGoodConsumed = consumed.get(line.itemId) ?? "0";
        const cumulativeDamaged = damaged.get(line.itemId) ?? "0";
        return {
          requirementId: line.id,
          itemId: line.itemId,
          itemCode: line.item.code,
          itemName: line.item.name,
          usageBasis: line.usageBasis,
          standardRequiredQuantity: line.standardRequiredQuantity.toString(),
          allowancePercent: line.allowancePercent.toString(),
          recommendedIssueQuantity: line.recommendedIssueQuantity.toString(),
          availableQuantity: available.get(line.itemId) ?? "0",
          cumulativeIssued,
          remainingPlannedQuantity: Decimal.max(
            new Decimal(line.standardRequiredQuantity).sub(cumulativeIssued),
            0,
          ).toFixed(),
          cumulativeReturned,
          cumulativeGoodConsumed,
          cumulativeDamaged,
          ...reconcilePackaging({
            plannedStandard: line.standardRequiredQuantity.toString(),
            issued: cumulativeIssued,
            returned: cumulativeReturned,
            goodConsumed: cumulativeGoodConsumed,
            damaged: cumulativeDamaged,
          }),
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

async function prepareLine(input: PackagingTransactionInput) {
  const [requirement, units, lot, destination] = await Promise.all([
    prisma.productionPackagingRequirement.findFirst({
      where: { id: input.packagingRequirementId, productionBatchId: input.productionBatchId },
      include: { productionBatch: true, item: true },
    }),
    new PrismaRecipeRepository().listRecipeUnits(),
    prisma.inventoryLot.findUnique({ where: { id: input.inventoryLotId } }),
    input.destinationWarehouseId
      ? prisma.warehouse.findFirst({ where: { id: input.destinationWarehouseId, active: true } })
      : null,
  ]);
  if (
    !requirement ||
    requirement.productionBatch.status !== "IN_PROGRESS" ||
    !requirement.item.active ||
    !lot ||
    lot.itemId !== requirement.itemId
  )
    throw new ProductionPackagingRepositoryError(
      "invalid-reference",
      "Select an active packaging requirement and matching lot on an IN_PROGRESS batch.",
    );
  if (input.transactionType === "RETURN" && !destination)
    throw new ProductionPackagingRepositoryError(
      "invalid-reference",
      "Select an active return destination warehouse.",
    );
  if ((input.transactionType === "DAMAGE") !== Boolean(input.damageReason))
    throw new ProductionPackagingRepositoryError(
      "invalid-reference",
      "Packaging damage requires one controlled reason.",
    );
  const unit = units.find((candidate) => candidate.id === input.unitId);
  if (!unit || unit.dimension !== requirement.canonicalUnitDimension)
    throw new ProductionPackagingRepositoryError(
      "invalid-reference",
      "Select a compatible active unit.",
    );
  const normalized = normalizeQuantity({ amount: input.quantity, unit }, units);
  const canonical = units.find(
    (candidate) =>
      candidate.code === normalized.unit.code && candidate.id === requirement.canonicalUnitId,
  );
  const amount = new Decimal(normalized.amount);
  if (!canonical || amount.lte(0) || (canonical.dimension === "COUNT" && !amount.isInteger()))
    throw new ProductionPackagingRepositoryError(
      "invalid-reference",
      "Packaging quantity must be positive, canonical, and whole when COUNT-based.",
    );
  return {
    position: 1,
    batchRequirementId: null,
    packagingRequirementId: requirement.id,
    itemId: requirement.itemId,
    itemType: "PACKAGING_MATERIAL" as const,
    sourceWarehouseId: requirement.productionBatch.packagingWarehouseId,
    destinationWarehouseId:
      input.transactionType === "ISSUE"
        ? requirement.productionBatch.packagingWarehouseId
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
  if (!itemIds.length) return [];
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
    new Decimal(group._sum.quantity?.toString() ?? 0).gt(0),
  );
  const [lots, units] = await Promise.all([
    prisma.inventoryLot.findMany({
      where: { id: { in: positive.map((group) => group.inventoryLotId!) } },
      include: { item: true, supplier: true, sourceGoodsReceipt: true },
    }),
    prisma.unit.findMany({ where: { id: { in: positive.map((group) => group.canonicalUnitId) } } }),
  ]);
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
      availableQuantity: group._sum.quantity?.toString() ?? "0",
      canonicalUnitId: unit.id,
      canonicalUnitCode: unit.code,
      canonicalUnitSymbol: unit.symbol,
      canonicalUnitDimension: unit.dimension,
    };
  });
}

async function aggregate(where: Prisma.InventoryMovementWhereInput, absolute = false) {
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

function mapTransaction(row: TransactionRow): PackagingTransactionRecord {
  const line = row.lines[0];
  if (!line || !line.packagingRequirementId || row.materialType !== "PACKAGING_MATERIAL")
    throw new ProductionPackagingRepositoryError(
      "invalid-state",
      "Packaging transaction is incomplete.",
    );
  return {
    id: row.id,
    transactionNumber: row.transactionNumber,
    productionBatchId: row.productionBatchId,
    transactionType: row.transactionType,
    transactionDate: row.transactionDate,
    status: row.status,
    damageReason: row.damageReason,
    notes: row.notes,
    createdByName: row.createdBy.name,
    postedByName: row.postedBy?.name ?? null,
    postedAt: row.postedAt,
    line: {
      id: line.id,
      packagingRequirementId: line.packagingRequirementId,
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
      enteredUnitSymbol: line.enteredUnit.symbol,
      normalizedQuantity: line.normalizedQuantity.toString(),
      canonicalUnitId: line.canonicalUnitId,
      canonicalUnitSymbol: line.canonicalUnit.symbol,
      canonicalUnitDimension: line.canonicalUnitDimension,
    },
  };
}

async function nextNumber(transaction: Prisma.TransactionClient, type: PackagingTransactionType) {
  const year = new Date().getUTCFullYear();
  const sequence = await transaction.productionMaterialTransactionSequence.upsert({
    where: {
      materialType_transactionType_year: {
        materialType: "PACKAGING_MATERIAL",
        transactionType: type,
        year,
      },
    },
    create: { materialType: "PACKAGING_MATERIAL", transactionType: type, year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  const prefix =
    type === "ISSUE" ? "PI" : type === "RETURN" ? "PR" : type === "CONSUMPTION" ? "PC" : "PD";
  const value = sequence.nextValue - 1;
  if (value > 999999)
    throw new ProductionPackagingRepositoryError(
      "conflict",
      "Annual packaging sequence is exhausted.",
    );
  return `${prefix}-${year}-${String(value).padStart(6, "0")}`;
}

function parseDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()))
    throw new ProductionPackagingRepositoryError(
      "invalid-reference",
      "Transaction date is invalid.",
    );
  return date;
}

async function validateActor(transaction: Prisma.TransactionClient, actorUserId: string) {
  if ((await transaction.user.count({ where: { id: actorUserId, active: true } })) !== 1)
    throw new ProductionPackagingRepositoryError("invalid-reference", "Acting user is inactive.");
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
  throw new ProductionPackagingRepositoryError(
    "conflict",
    "Packaging transaction conflict; retry.",
  );
}

function mapError(error: unknown) {
  if (error instanceof ProductionPackagingRepositoryError) return error;
  if (error instanceof InventoryRepositoryError)
    return new ProductionPackagingRepositoryError(
      error.reason === "reference" ? "invalid-reference" : error.reason,
      error.message,
    );
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ["P2002", "P2003", "P2004"].includes(error.code)
  )
    return new ProductionPackagingRepositoryError(
      error.code === "P2002" ? "conflict" : "invalid-reference",
      "Packaging transaction conflicts with protected production or inventory data.",
    );
  return error instanceof Error
    ? error
    : new ProductionPackagingRepositoryError("conflict", "Packaging transaction failed.");
}
