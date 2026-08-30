import "server-only";

import Decimal from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import type {
  BatchRecipeOption,
  ProductionBatchInput,
  ProductionBatchPage,
  ProductionBatchQuery,
  ProductionBatchRecord,
  ProductionBatchRepository,
} from "@/modules/production/application/batch-contracts";
import { ProductionBatchRepositoryError } from "@/modules/production/application/batch-contracts";
import { calculateProductionBatch } from "@/modules/production/domain/batch-calculations";
import { prisma } from "@/server/db/prisma";
import { recordAuditEvent } from "@/server/audit/audit-event";
import { PrismaRecipeRepository } from "./prisma-recipe-repository";

const PAGE_SIZE = 25;
const batchInclude = {
  recipe: true,
  finishedGood: true,
  plannedBatchUnit: true,
  plannedBatchCanonicalUnit: true,
  expectedOutputCanonicalUnit: true,
  productContentCanonicalUnit: true,
  rawMaterialWarehouse: true,
  packagingWarehouse: true,
  finishedGoodsDestinationWarehouse: true,
  createdBy: true,
  releasedBy: true,
  cancelledBy: true,
  materialRequirements: {
    include: { item: true, canonicalUnit: true },
    orderBy: { sequence: "asc" as const },
  },
  packagingRequirements: {
    include: { item: true, canonicalUnit: true },
    orderBy: { sequence: "asc" as const },
  },
} satisfies Prisma.ProductionBatchInclude;
type BatchRow = Prisma.ProductionBatchGetPayload<{ include: typeof batchInclude }>;

export class PrismaProductionBatchRepository implements ProductionBatchRepository {
  async listApprovedRecipes(): Promise<readonly BatchRecipeOption[]> {
    const rows = await prisma.recipe.findMany({
      where: {
        status: "APPROVED",
        finishedGood: { active: true, finishedGoodProfile: { isNot: null } },
      },
      include: {
        finishedGood: { include: { finishedGoodProfile: true } },
        standardBatchUnit: true,
        expectedOutputUnit: true,
      },
      orderBy: [{ finishedGood: { name: "asc" } }, { code: "asc" }, { version: "desc" }],
      take: 1000,
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      version: row.version,
      status: row.status,
      finishedGoodId: row.finishedGoodId,
      finishedGoodCode: row.finishedGood.code,
      finishedGoodName: row.finishedGood.name,
      standardBatchQuantity: row.standardBatchEnteredQuantity.toString(),
      standardBatchUnitId: row.standardBatchUnitId,
      standardBatchUnitCode: row.standardBatchUnit.code,
      standardBatchUnitSymbol: row.standardBatchUnit.symbol,
      standardBatchDimension: row.standardBatchCanonicalDimension,
      expectedOutputQuantity: row.expectedOutputEnteredQuantity?.toString() ?? null,
      expectedOutputUnitSymbol: row.expectedOutputUnit?.symbol ?? null,
      piecesPerCarton: row.finishedGood.finishedGoodProfile!.piecesPerCarton,
    }));
  }

  async listBatchUnits() {
    return new PrismaRecipeRepository().listRecipeUnits();
  }

  async listActiveWarehouses() {
    return prisma.warehouse.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true, active: true },
      orderBy: { name: "asc" },
      take: 500,
    });
  }

  async createBatch(input: ProductionBatchInput) {
    const prepared = await prepare(input);
    return serializable(async (transaction) => {
      await validateReferences(transaction, input, prepared.header.recipeId);
      await validateLifecycleReferences(transaction, {
        recipeId: prepared.header.recipeId,
        rawMaterialWarehouseId: input.rawMaterialWarehouseId,
        packagingWarehouseId: input.packagingWarehouseId,
        finishedGoodsDestinationWarehouseId: input.finishedGoodsDestinationWarehouseId,
        materialRequirements: prepared.materialRequirements,
      });
      const batchNumber = await nextBatchNumber(transaction);
      return (
        await transaction.productionBatch.create({
          data: {
            batchNumber,
            ...prepared.header,
            plannedProductionDate: requiredDate(input.plannedProductionDate, "production date"),
            targetCompletionDate: optionalDate(input.targetCompletionDate, "target completion"),
            rawMaterialWarehouseId: input.rawMaterialWarehouseId,
            packagingWarehouseId: input.packagingWarehouseId,
            finishedGoodsDestinationWarehouseId: input.finishedGoodsDestinationWarehouseId,
            notes: input.notes ?? null,
            createdByUserId: input.actorUserId,
            materialRequirements: { create: [...prepared.materialRequirements] },
            packagingRequirements: { create: [...prepared.packagingRequirements] },
          },
        })
      ).id;
    });
  }

  async updateBatch(input: ProductionBatchInput & { id: string }) {
    const prepared = await prepare(input);
    return serializable(async (transaction) => {
      const current = await transaction.productionBatch.findUnique({ where: { id: input.id } });
      if (!current || current.status !== "DRAFT")
        throw new ProductionBatchRepositoryError(
          "invalid-state",
          "Only a DRAFT production batch can be edited.",
        );
      await validateReferences(transaction, input, prepared.header.recipeId);
      await validateLifecycleReferences(transaction, {
        recipeId: prepared.header.recipeId,
        rawMaterialWarehouseId: input.rawMaterialWarehouseId,
        packagingWarehouseId: input.packagingWarehouseId,
        finishedGoodsDestinationWarehouseId: input.finishedGoodsDestinationWarehouseId,
        materialRequirements: prepared.materialRequirements,
      });
      await transaction.productionMaterialRequirement.deleteMany({
        where: { productionBatchId: input.id },
      });
      await transaction.productionPackagingRequirement.deleteMany({
        where: { productionBatchId: input.id },
      });
      await transaction.productionBatch.update({
        where: { id: input.id },
        data: {
          ...prepared.header,
          plannedProductionDate: requiredDate(input.plannedProductionDate, "production date"),
          targetCompletionDate: optionalDate(input.targetCompletionDate, "target completion"),
          rawMaterialWarehouseId: input.rawMaterialWarehouseId,
          packagingWarehouseId: input.packagingWarehouseId,
          finishedGoodsDestinationWarehouseId: input.finishedGoodsDestinationWarehouseId,
          notes: input.notes ?? null,
          materialRequirements: { create: [...prepared.materialRequirements] },
          packagingRequirements: { create: [...prepared.packagingRequirements] },
        },
      });
      return input.id;
    });
  }

  async planBatch(id: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const batch = await transaction.productionBatch.findUnique({
        where: { id },
        include: { materialRequirements: true, packagingRequirements: true },
      });
      if (!batch || batch.status !== "DRAFT")
        throw new ProductionBatchRepositoryError(
          "invalid-state",
          "Only a DRAFT production batch can be planned.",
        );
      await validateLifecycleReferences(transaction, batch);
      await transaction.productionBatch.update({ where: { id }, data: { status: "PLANNED" } });
      await recordAuditEvent(transaction, {
        actorUserId,
        action: "UPDATE",
        entityType: "PRODUCTION_BATCH",
        entityId: batch.id,
        entityReference: batch.batchNumber,
        module: "production",
        description: `Planned production batch ${batch.batchNumber}.`,
        beforeSnapshot: { status: batch.status },
        afterSnapshot: { status: "PLANNED" },
        controlEvent: true,
      });
    });
  }

  async releaseBatch(id: string, actorUserId: string, acknowledgeShortage: boolean) {
    return serializable(async (transaction) => {
      const batch = await transaction.productionBatch.findUnique({
        where: { id },
        include: { materialRequirements: true, packagingRequirements: true },
      });
      if (!batch || batch.status !== "PLANNED")
        throw new ProductionBatchRepositoryError(
          "invalid-state",
          "Only a PLANNED production batch can be released.",
        );
      await validateLifecycleReferences(transaction, batch);
      const hasShortage = await currentShortage(transaction, batch);
      if (hasShortage && !acknowledgeShortage)
        throw new ProductionBatchRepositoryError(
          "shortage",
          "Current stock is short. Confirm the shortage acknowledgement to release this batch.",
        );
      await transaction.productionBatch.update({
        where: { id },
        data: { status: "RELEASED", releasedByUserId: actorUserId, releasedAt: new Date() },
      });
      await recordAuditEvent(transaction, {
        actorUserId,
        action: "RELEASE",
        entityType: "PRODUCTION_BATCH",
        entityId: batch.id,
        entityReference: batch.batchNumber,
        module: "production",
        description: `Released production batch ${batch.batchNumber}.`,
        metadata: { shortageAcknowledged: hasShortage && acknowledgeShortage },
        beforeSnapshot: { status: batch.status },
        afterSnapshot: { status: "RELEASED" },
        controlEvent: true,
      });
      return hasShortage;
    });
  }

  async cancelBatch(id: string, actorUserId: string, reason: string) {
    await serializable(async (transaction) => {
      const batch = await transaction.productionBatch.findUnique({ where: { id } });
      if (!batch || !["DRAFT", "PLANNED", "RELEASED"].includes(batch.status))
        throw new ProductionBatchRepositoryError(
          "invalid-state",
          "Only a DRAFT, PLANNED, or RELEASED batch can be cancelled before material issue.",
        );
      await transaction.productionBatch.update({
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
        entityType: "PRODUCTION_BATCH",
        entityId: batch.id,
        entityReference: batch.batchNumber,
        module: "production",
        description: `Cancelled production batch ${batch.batchNumber}.`,
        reasonCode: "OPERATIONAL_CORRECTION",
        reason,
        beforeSnapshot: { status: batch.status },
        afterSnapshot: { status: "CANCELLED" },
        controlEvent: true,
      });
    });
  }

  async getBatch(id: string) {
    const row = await prisma.productionBatch.findUnique({ where: { id }, include: batchInclude });
    return row ? mapBatch(row) : null;
  }

  async listBatches(query: ProductionBatchQuery): Promise<ProductionBatchPage> {
    const dateTo = query.date ? new Date(query.date) : undefined;
    dateTo?.setUTCDate(dateTo.getUTCDate() + 1);
    const where = {
      ...(query.query
        ? {
            OR: [
              { batchNumber: { contains: query.query, mode: "insensitive" as const } },
              { finishedGood: { name: { contains: query.query, mode: "insensitive" as const } } },
              { finishedGood: { code: { contains: query.query, mode: "insensitive" as const } } },
            ],
          }
        : {}),
      ...(query.finishedGoodId ? { finishedGoodId: query.finishedGoodId } : {}),
      ...(query.recipeId ? { recipeId: query.recipeId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.date ? { plannedProductionDate: { gte: query.date, lt: dateTo! } } : {}),
    };
    const [total, rows] = await prisma.$transaction([
      prisma.productionBatch.count({ where }),
      prisma.productionBatch.findMany({
        where,
        include: batchInclude,
        orderBy: [{ plannedProductionDate: "desc" }, { batchNumber: "desc" }],
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    return {
      records: await Promise.all(rows.map(mapBatch)),
      page: query.page,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      total,
    };
  }
}

async function prepare(input: ProductionBatchInput) {
  const recipeRepository = new PrismaRecipeRepository();
  const [recipe, units] = await Promise.all([
    recipeRepository.getRecipe(input.recipeId),
    recipeRepository.listRecipeUnits(),
  ]);
  if (!recipe || recipe.status !== "APPROVED")
    throw new ProductionBatchRepositoryError(
      "invalid-reference",
      "Select an approved active recipe version.",
    );
  const profile = await prisma.finishedGoodProfile.findUnique({
    where: { itemId: recipe.finishedGoodId },
    include: { item: true, netContentUnit: true },
  });
  if (!profile?.item.active || !profile.netContentUnit.active)
    throw new ProductionBatchRepositoryError(
      "invalid-reference",
      "The finished-good profile is inactive or invalid.",
    );
  try {
    return calculateProductionBatch(
      recipe,
      {
        quantity: input.plannedBatchQuantity,
        unitId: input.plannedBatchUnitId,
        cartons: input.plannedCartons,
        loosePieces: input.plannedLoosePieces,
      },
      { quantity: profile.netContentQuantity.toString(), unitId: profile.netContentUnitId },
      units,
    );
  } catch (error) {
    throw new ProductionBatchRepositoryError(
      "invalid-reference",
      error instanceof Error ? error.message : "Production plan calculation failed.",
    );
  }
}

async function validateReferences(
  transaction: Prisma.TransactionClient,
  input: ProductionBatchInput,
  recipeId: string,
) {
  const [recipe, warehouseCount, actorCount] = await Promise.all([
    transaction.recipe.count({
      where: {
        id: recipeId,
        status: "APPROVED",
        finishedGood: { active: true, finishedGoodProfile: { isNot: null } },
      },
    }),
    transaction.warehouse.count({
      where: {
        id: {
          in: [
            input.rawMaterialWarehouseId,
            input.packagingWarehouseId,
            input.finishedGoodsDestinationWarehouseId,
          ],
        },
        active: true,
      },
    }),
    transaction.user.count({ where: { id: input.actorUserId, active: true } }),
  ]);
  const uniqueWarehouses = new Set([
    input.rawMaterialWarehouseId,
    input.packagingWarehouseId,
    input.finishedGoodsDestinationWarehouseId,
  ]).size;
  if (recipe !== 1 || warehouseCount !== uniqueWarehouses || actorCount !== 1)
    throw new ProductionBatchRepositoryError(
      "invalid-reference",
      "The recipe, warehouse, or acting user is no longer active and eligible.",
    );
}

async function validateLifecycleReferences(
  transaction: Prisma.TransactionClient,
  batch: {
    recipeId: string;
    rawMaterialWarehouseId: string;
    packagingWarehouseId: string;
    finishedGoodsDestinationWarehouseId: string;
    materialRequirements: readonly unknown[];
  },
) {
  const recipe = await transaction.recipe.findFirst({
    where: { id: batch.recipeId, status: "APPROVED", finishedGood: { active: true } },
    include: {
      ingredients: true,
      packagingBom: { include: { lines: true } },
    },
  });
  if (!recipe || recipe.ingredients.length === 0)
    throw new ProductionBatchRepositoryError(
      "invalid-reference",
      "Planning and release require an approved recipe with raw-material requirements.",
    );
  const ingredientIds = [...new Set(recipe.ingredients.map((line) => line.itemId))];
  const packagingIds = [...new Set((recipe.packagingBom?.lines ?? []).map((line) => line.itemId))];
  const unitIds = [
    ...new Set([
      recipe.standardBatchUnitId,
      ...(recipe.expectedOutputUnitId ? [recipe.expectedOutputUnitId] : []),
      ...recipe.ingredients.flatMap((line) => [line.enteredUnitId, line.canonicalUnitId]),
      ...(recipe.packagingBom?.lines ?? []).flatMap((line) => [
        line.enteredUnitId,
        line.canonicalUnitId,
      ]),
    ]),
  ];
  const [warehouses, activeIngredients, activePackaging, activeUnits] = await Promise.all([
    transaction.warehouse.count({
      where: {
        id: {
          in: [
            batch.rawMaterialWarehouseId,
            batch.packagingWarehouseId,
            batch.finishedGoodsDestinationWarehouseId,
          ],
        },
        active: true,
      },
    }),
    transaction.item.count({
      where: { id: { in: ingredientIds }, itemType: "RAW_MATERIAL", active: true },
    }),
    transaction.item.count({
      where: { id: { in: packagingIds }, itemType: "PACKAGING_MATERIAL", active: true },
    }),
    transaction.unit.count({ where: { id: { in: unitIds }, active: true } }),
  ]);
  const uniqueWarehouses = new Set([
    batch.rawMaterialWarehouseId,
    batch.packagingWarehouseId,
    batch.finishedGoodsDestinationWarehouseId,
  ]).size;
  if (
    warehouses !== uniqueWarehouses ||
    activeIngredients !== ingredientIds.length ||
    activePackaging !== packagingIds.length ||
    activeUnits !== unitIds.length
  )
    throw new ProductionBatchRepositoryError(
      "invalid-reference",
      "Planning and release require an approved recipe, complete requirements, and active warehouses.",
    );
}

async function currentShortage(
  transaction: Prisma.TransactionClient,
  batch: {
    rawMaterialWarehouseId: string;
    packagingWarehouseId: string;
    materialRequirements: readonly { itemId: string; recommendedIssueQuantity: Decimal }[];
    packagingRequirements: readonly { itemId: string; recommendedIssueQuantity: Decimal }[];
  },
) {
  const [materials, packaging] = await Promise.all([
    availableByItem(
      transaction,
      batch.rawMaterialWarehouseId,
      batch.materialRequirements.map((line) => line.itemId),
    ),
    availableByItem(
      transaction,
      batch.packagingWarehouseId,
      batch.packagingRequirements.map((line) => line.itemId),
    ),
  ]);
  return (
    batch.materialRequirements.some((line) =>
      new Decimal(line.recommendedIssueQuantity).gt(materials.get(line.itemId) ?? 0),
    ) ||
    batch.packagingRequirements.some((line) =>
      new Decimal(line.recommendedIssueQuantity).gt(packaging.get(line.itemId) ?? 0),
    )
  );
}

async function mapBatch(row: BatchRow): Promise<ProductionBatchRecord> {
  const [materialAvailability, packagingAvailability] = await Promise.all([
    availableByItem(
      prisma,
      row.rawMaterialWarehouseId,
      row.materialRequirements.map((line) => line.itemId),
    ),
    availableByItem(
      prisma,
      row.packagingWarehouseId,
      row.packagingRequirements.map((line) => line.itemId),
    ),
  ]);
  const materials = row.materialRequirements.map((line) =>
    requirementAvailability(materialAvailability.get(line.itemId) ?? "0", {
      id: line.id,
      sequence: line.sequence,
      recipeIngredientId: line.recipeIngredientId,
      itemId: line.itemId,
      itemCode: line.item.code,
      itemName: line.item.name,
      standardNormalizedQuantity: line.standardNormalizedQuantity.toString(),
      plannedNormalizedQuantity: line.plannedNormalizedQuantity.toString(),
      allowancePercent: line.allowancePercent.toString(),
      recommendedIssueQuantity: line.recommendedIssueQuantity.toString(),
      canonicalUnitId: line.canonicalUnitId,
      canonicalUnitCode: line.canonicalUnit.code,
      canonicalUnitSymbol: line.canonicalUnit.symbol,
      canonicalUnitDimension: line.canonicalUnitDimension,
    }),
  );
  const packaging = row.packagingRequirements.map((line) =>
    requirementAvailability(packagingAvailability.get(line.itemId) ?? "0", {
      id: line.id,
      sequence: line.sequence,
      packagingBomLineId: line.packagingBomLineId,
      itemId: line.itemId,
      itemCode: line.item.code,
      itemName: line.item.name,
      usageBasis: line.usageBasis,
      standardRequiredQuantity: line.standardRequiredQuantity.toString(),
      allowancePercent: line.allowancePercent.toString(),
      recommendedIssueQuantity: line.recommendedIssueQuantity.toString(),
      canonicalUnitId: line.canonicalUnitId,
      canonicalUnitCode: line.canonicalUnit.code,
      canonicalUnitSymbol: line.canonicalUnit.symbol,
      canonicalUnitDimension: line.canonicalUnitDimension,
    }),
  );
  return {
    id: row.id,
    batchNumber: row.batchNumber,
    recipeId: row.recipeId,
    recipeCode: row.recipe.code,
    recipeName: row.recipe.name,
    recipeVersion: row.recipeVersion,
    finishedGoodId: row.finishedGoodId,
    finishedGoodCode: row.finishedGood.code,
    finishedGoodName: row.finishedGood.name,
    status: row.status,
    plannedBatchEnteredQuantity: row.plannedBatchEnteredQuantity.toString(),
    plannedBatchUnitId: row.plannedBatchUnitId,
    plannedBatchUnitCode: row.plannedBatchUnit.code,
    plannedBatchUnitSymbol: row.plannedBatchUnit.symbol,
    plannedBatchNormalizedQuantity: row.plannedBatchNormalizedQuantity.toString(),
    plannedBatchCanonicalUnitId: row.plannedBatchCanonicalUnitId,
    plannedBatchCanonicalCode: row.plannedBatchCanonicalUnit.code,
    plannedBatchCanonicalSymbol: row.plannedBatchCanonicalUnit.symbol,
    plannedBatchDimension: row.plannedBatchCanonicalDimension,
    scaleFactor: new Decimal(row.plannedBatchNormalizedQuantity)
      .div(row.recipe.standardBatchNormalizedQuantity)
      .toFixed(),
    plannedExpectedOutputNormalizedQuantity:
      row.plannedExpectedOutputNormalizedQuantity?.toString() ?? null,
    expectedOutputCanonicalCode: row.expectedOutputCanonicalUnit?.code ?? null,
    expectedOutputCanonicalSymbol: row.expectedOutputCanonicalUnit?.symbol ?? null,
    expectedYieldPercent: row.expectedYieldPercent?.toString() ?? null,
    plannedCartons: row.plannedCartons.toString(),
    plannedLoosePieces: row.plannedLoosePieces.toString(),
    plannedTotalPieces: row.plannedTotalPieces.toString(),
    plannedProductContentNormalizedQuantity: row.plannedProductContentNormalizedQuantity.toString(),
    productContentCanonicalCode: row.productContentCanonicalUnit.code,
    productContentCanonicalSymbol: row.productContentCanonicalUnit.symbol,
    expectedOutputDifferenceNormalizedQuantity:
      row.expectedOutputDifferenceNormalizedQuantity?.toString() ?? null,
    plannedProductionDate: row.plannedProductionDate,
    targetCompletionDate: row.targetCompletionDate,
    rawMaterialWarehouseId: row.rawMaterialWarehouseId,
    rawMaterialWarehouseCode: row.rawMaterialWarehouse.code,
    rawMaterialWarehouseName: row.rawMaterialWarehouse.name,
    packagingWarehouseId: row.packagingWarehouseId,
    packagingWarehouseCode: row.packagingWarehouse.code,
    packagingWarehouseName: row.packagingWarehouse.name,
    finishedGoodsDestinationWarehouseId: row.finishedGoodsDestinationWarehouseId,
    finishedGoodsDestinationWarehouseCode: row.finishedGoodsDestinationWarehouse.code,
    finishedGoodsDestinationWarehouseName: row.finishedGoodsDestinationWarehouse.name,
    notes: row.notes,
    createdByName: row.createdBy.name,
    releasedByName: row.releasedBy?.name ?? null,
    releasedAt: row.releasedAt,
    cancelledByName: row.cancelledBy?.name ?? null,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hasShortage:
      materials.some((line) => new Decimal(line.shortageQuantity).gt(0)) ||
      packaging.some((line) => new Decimal(line.shortageQuantity).gt(0)),
    materialRequirements: materials,
    packagingRequirements: packaging,
  };
}

function requirementAvailability<T extends { recommendedIssueQuantity: string }>(
  available: string,
  record: T,
) {
  const difference = new Decimal(available).sub(record.recommendedIssueQuantity);
  return {
    ...record,
    availableQuantity: new Decimal(available).toFixed(),
    shortageQuantity: Decimal.max(difference.negated(), 0).toFixed(),
    surplusQuantity: Decimal.max(difference, 0).toFixed(),
  };
}

async function availableByItem(
  client: Prisma.TransactionClient | typeof prisma,
  warehouseId: string,
  itemIds: readonly string[],
) {
  if (itemIds.length === 0) return new Map<string, string>();
  const rows = await client.inventoryMovement.groupBy({
    by: ["itemId"],
    where: { itemId: { in: [...new Set(itemIds)] }, warehouseId, status: "AVAILABLE" },
    _sum: { quantity: true },
  });
  return new Map(rows.map((row) => [row.itemId, row._sum.quantity?.toString() ?? "0"]));
}

async function nextBatchNumber(transaction: Prisma.TransactionClient) {
  const year = new Date().getUTCFullYear();
  const sequence = await transaction.productionBatchSequence.upsert({
    where: { year },
    create: { year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  const value = sequence.nextValue - 1;
  if (value > 999999)
    throw new ProductionBatchRepositoryError("conflict", "Annual batch sequence is exhausted.");
  return `BATCH-${year}-${String(value).padStart(6, "0")}`;
}

function requiredDate(value: string, label: string) {
  const date = optionalDate(value, label);
  if (!date) throw new ProductionBatchRepositoryError("invalid-reference", `${label} is required.`);
  return date;
}

function optionalDate(value: string | undefined, label: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
    throw new ProductionBatchRepositoryError("invalid-reference", `${label} is invalid.`);
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
  throw new ProductionBatchRepositoryError("conflict", "Production batch conflict; retry.");
}

function mapError(error: unknown) {
  if (error instanceof ProductionBatchRepositoryError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return new ProductionBatchRepositoryError("conflict", "Production batch number conflicts.");
    if (["P2003", "P2004"].includes(error.code))
      return new ProductionBatchRepositoryError(
        "invalid-reference",
        "Production batch data conflicts with protected recipe or warehouse references.",
      );
  }
  return error instanceof Error
    ? error
    : new ProductionBatchRepositoryError("conflict", "Production batch operation failed.");
}
