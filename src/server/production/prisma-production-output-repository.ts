import "server-only";

import Decimal from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import { InventoryRepositoryError } from "@/modules/inventory/application/contracts";
import type {
  OutputTransactionInput,
  OutputTransactionRecord,
  ProductionOutputRepository,
  ProductionOutputView,
} from "@/modules/production/application/output-contracts";
import { ProductionOutputRepositoryError } from "@/modules/production/application/output-contracts";
import {
  calculateFinalPackagingStandard,
  calculateOutputReconciliation,
  normalizeGoodOutput,
} from "@/modules/production/domain/output-calculations";
import { piecesToCartons } from "@/modules/quantity/domain/cartons";
import { normalizeQuantity } from "@/modules/quantity/domain/quantity";
import { prisma } from "@/server/db/prisma";
import { postProductionOutputInventory } from "@/server/inventory/transactional-inventory-posting";
import { PrismaProductionMaterialRepository } from "./prisma-production-material-repository";
import { PrismaProductionPackagingRepository } from "./prisma-production-packaging-repository";
import { PrismaRecipeRepository } from "./prisma-recipe-repository";

const include = {
  productionBatch: true,
  productionLot: true,
  destinationWarehouse: true,
  enteredUnit: true,
  canonicalUnit: true,
  createdBy: true,
  postedBy: true,
} satisfies Prisma.ProductionOutputTransactionInclude;
type OutputRow = Prisma.ProductionOutputTransactionGetPayload<{ include: typeof include }>;

export class PrismaProductionOutputRepository implements ProductionOutputRepository {
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

  async createTransaction(input: OutputTransactionInput) {
    const prepared = await prepare(input);
    return serializable(async (transaction) => {
      await validateActor(transaction, input.actorUserId);
      const outputNumber = await nextNumber(transaction);
      return (
        await transaction.productionOutputTransaction.create({
          data: {
            outputNumber,
            productionBatchId: input.productionBatchId,
            outputType: input.outputType,
            transactionDate: parseDateTime(input.transactionDate),
            ...prepared,
            createdByUserId: input.actorUserId,
          },
        })
      ).id;
    });
  }

  async updateTransaction(input: OutputTransactionInput & { id: string }) {
    const prepared = await prepare(input);
    return serializable(async (transaction) => {
      const current = await transaction.productionOutputTransaction.findUnique({
        where: { id: input.id },
      });
      if (
        !current ||
        current.status !== "DRAFT" ||
        current.productionBatchId !== input.productionBatchId ||
        current.outputType !== input.outputType
      )
        throw new ProductionOutputRepositoryError(
          "invalid-state",
          "Only an output DRAFT may be edited without changing its batch or type.",
        );
      await validateActor(transaction, input.actorUserId);
      await transaction.productionOutputTransaction.update({
        where: { id: input.id },
        data: { transactionDate: parseDateTime(input.transactionDate), ...prepared },
      });
      return input.id;
    });
  }

  async postTransaction(id: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const row = await transaction.productionOutputTransaction.findUnique({
        where: { id },
        include: {
          productionBatch: {
            include: { finishedGood: { include: { stockUnit: true } } },
          },
        },
      });
      if (!row || row.status !== "DRAFT" || row.productionBatch.status !== "IN_PROGRESS")
        throw new ProductionOutputRepositoryError(
          "invalid-state",
          "A DRAFT output on an IN_PROGRESS batch is required.",
        );
      await validateActor(transaction, actorUserId);
      await transaction.$queryRaw`
        SELECT "id" FROM "production_batch"
        WHERE "id" = ${row.productionBatchId}
        FOR UPDATE
      `;
      const existingLot = await transaction.productionLot.findUnique({
        where: { productionBatchId: row.productionBatchId },
      });
      const lot =
        existingLot ??
        (await transaction.productionLot.create({
          data: {
            lotNumber: `LOT-${row.productionBatch.batchNumber}`,
            productionBatchId: row.productionBatchId,
            finishedGoodId: row.productionBatch.finishedGoodId,
            recipeId: row.productionBatch.recipeId,
            recipeVersion: row.productionBatch.recipeVersion,
            productionDate: row.productionDate,
            expiryDate: row.expiryDate,
          },
        }));
      if (
        lot.productionDate.valueOf() !== row.productionDate.valueOf() ||
        (lot.expiryDate?.valueOf() ?? null) !== (row.expiryDate?.valueOf() ?? null)
      )
        throw new ProductionOutputRepositoryError(
          "invalid-reference",
          "This batch already has a production lot with different production or expiry dates.",
        );
      const quantity =
        row.outputType === "GOOD"
          ? row.totalPieces?.toString()
          : row.normalizedQuantity?.toString();
      const canonicalUnitId =
        row.outputType === "GOOD"
          ? row.productionBatch.finishedGood.stockUnitId
          : row.canonicalUnitId;
      if (!quantity || !canonicalUnitId)
        throw new ProductionOutputRepositoryError(
          "invalid-reference",
          "Output quantity is incomplete.",
        );
      await transaction.productionOutputTransaction.update({
        where: { id },
        data: { productionLotId: lot.id },
      });
      await postProductionOutputInventory(transaction, {
        outputType: row.outputType,
        transactionId: row.id,
        outputNumber: row.outputNumber,
        productionBatchId: row.productionBatchId,
        productionLotId: lot.id,
        itemId: row.productionBatch.finishedGoodId,
        warehouseId: row.destinationWarehouseId,
        canonicalUnitId,
        quantity,
        reason:
          row.notes ??
          `${row.outputType.replaceAll("_", " ")} for ${row.productionBatch.batchNumber}.`,
        actorUserId,
      });
      await transaction.productionOutputTransaction.update({
        where: { id },
        data: {
          status: "POSTED",
          productionLotId: lot.id,
          postedByUserId: actorUserId,
          postedAt: new Date(),
        },
      });
    });
  }

  async cancelTransaction(id: string, actorUserId: string, reason: string) {
    await serializable(async (transaction) => {
      const current = await transaction.productionOutputTransaction.findUnique({ where: { id } });
      if (!current || current.status !== "DRAFT")
        throw new ProductionOutputRepositoryError(
          "invalid-state",
          "Only an output DRAFT may be cancelled.",
        );
      await validateActor(transaction, actorUserId);
      await transaction.productionOutputTransaction.update({
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
    const row = await prisma.productionOutputTransaction.findUnique({ where: { id }, include });
    return row ? mapTransaction(row) : null;
  }

  async getOutputView(batchId: string) {
    return buildView(prisma, batchId);
  }

  async completeBatch(batchId: string, actorUserId: string, explanation?: string) {
    await serializable(async (transaction) => {
      await validateActor(transaction, actorUserId);
      const snapshot = await completionSnapshot(transaction, batchId);
      if (snapshot.status !== "IN_PROGRESS")
        throw new ProductionOutputRepositoryError(
          "invalid-state",
          "Only an IN_PROGRESS batch may be completed.",
        );
      if (snapshot.blockers.length)
        throw new ProductionOutputRepositoryError("reconciliation", snapshot.blockers.join(" "));
      if (snapshot.needsExplanation && !explanation)
        throw new ProductionOutputRepositoryError(
          "reconciliation",
          "Explain the incompatible or nonzero physical reconciliation before completion.",
        );
      await transaction.productionBatch.update({
        where: { id: batchId },
        data: {
          status: "COMPLETED",
          completedByUserId: actorUserId,
          completedAt: new Date(),
          completionExplanation: explanation ?? null,
        },
      });
    });
  }
}

async function prepare(input: OutputTransactionInput) {
  const [batch, units, destination] = await Promise.all([
    prisma.productionBatch.findUnique({
      where: { id: input.productionBatchId },
      include: {
        finishedGood: {
          include: { stockUnit: true, finishedGoodProfile: { include: { netContentUnit: true } } },
        },
        productContentCanonicalUnit: true,
      },
    }),
    new PrismaRecipeRepository().listRecipeUnits(),
    prisma.warehouse.findFirst({ where: { id: input.destinationWarehouseId, active: true } }),
  ]);
  if (!batch || batch.status !== "IN_PROGRESS" || !batch.finishedGood.active || !destination)
    throw new ProductionOutputRepositoryError(
      "invalid-reference",
      "Select an IN_PROGRESS batch with an active finished good and destination warehouse.",
    );
  const productionDate = parseDate(input.productionDate, "Production date");
  const expiryDate = input.expiryDate ? parseDate(input.expiryDate, "Expiry date") : null;
  if (expiryDate && expiryDate < productionDate)
    throw new ProductionOutputRepositoryError(
      "invalid-reference",
      "Expiry cannot precede production date.",
    );
  if (input.outputType === "GOOD") {
    const profile = batch.finishedGood.finishedGoodProfile;
    if (!profile || input.destinationWarehouseId !== batch.finishedGoodsDestinationWarehouseId)
      throw new ProductionOutputRepositoryError(
        "invalid-reference",
        "Good output requires the batch finished-good profile and destination.",
      );
    const good = normalizeGoodOutput(input.cartons ?? "0", input.loosePieces ?? "0", {
      netContentQuantity: profile.netContentQuantity.toString(),
      netContentUnit: {
        code: profile.netContentUnit.code,
        symbol: profile.netContentUnit.symbol,
        dimension: profile.netContentUnit.dimension,
        active: profile.netContentUnit.active,
      },
      netContentUnitDimension: profile.netContentUnitDimension,
      piecesPerCarton: profile.piecesPerCarton,
    });
    return {
      cartons: Number(good.cartons),
      loosePieces: Number(good.loosePieces),
      totalPieces: good.totalPieces,
      enteredQuantity: null,
      enteredUnitId: null,
      enteredUnitDimension: null,
      normalizedQuantity: null,
      canonicalUnitId: null,
      canonicalUnitDimension: null,
      productionDate,
      expiryDate,
      destinationWarehouseId: input.destinationWarehouseId,
      lossReason: null,
      lossNature: null,
      notes: input.notes ?? null,
    };
  }
  const unit = units.find((candidate) => candidate.id === input.unitId);
  if (!unit || unit.dimension !== batch.productContentCanonicalDimension || !input.quantity)
    throw new ProductionOutputRepositoryError(
      "invalid-reference",
      "Non-good output requires a unit compatible with the finished-good content basis.",
    );
  const normalized = normalizeQuantity({ amount: input.quantity, unit }, units);
  const canonical = units.find(
    (candidate) =>
      candidate.id === batch.productContentCanonicalUnitId &&
      candidate.code === normalized.unit.code,
  );
  if (!canonical || new Decimal(normalized.amount).lte(0))
    throw new ProductionOutputRepositoryError("invalid-reference", "Output quantity is invalid.");
  if (
    input.outputType === "PROCESS_LOSS" &&
    (!input.lossReason || !input.lossNature || !input.notes || input.notes.trim().length < 3)
  )
    throw new ProductionOutputRepositoryError(
      "invalid-reference",
      "Process loss requires classification, nature, and explanatory notes.",
    );
  return {
    cartons: null,
    loosePieces: null,
    totalPieces: null,
    enteredQuantity: input.quantity,
    enteredUnitId: unit.id,
    enteredUnitDimension: unit.dimension,
    normalizedQuantity: normalized.amount,
    canonicalUnitId: batch.productContentCanonicalUnitId,
    canonicalUnitDimension: batch.productContentCanonicalDimension,
    productionDate,
    expiryDate,
    destinationWarehouseId: input.destinationWarehouseId,
    lossReason: input.outputType === "PROCESS_LOSS" ? input.lossReason! : null,
    lossNature: input.outputType === "PROCESS_LOSS" ? input.lossNature! : null,
    notes: input.notes ?? null,
  };
}

async function buildView(
  client: typeof prisma,
  batchId: string,
): Promise<ProductionOutputView | null> {
  const [batch, materialView, packagingView] = await Promise.all([
    client.productionBatch.findUnique({
      where: { id: batchId },
      include: {
        recipe: true,
        finishedGood: { include: { finishedGoodProfile: true } },
        plannedBatchUnit: true,
        productContentCanonicalUnit: true,
        expectedOutputCanonicalUnit: true,
        finishedGoodsDestinationWarehouse: true,
        completedBy: true,
        productionLot: true,
        outputTransactions: {
          include,
          orderBy: [{ transactionDate: "desc" }, { outputNumber: "desc" }],
        },
        packagingRequirements: {
          include: { packagingBomLine: true, canonicalUnit: true },
          orderBy: { sequence: "asc" },
        },
      },
    }),
    new PrismaProductionMaterialRepository().getBatchMaterialView(batchId),
    new PrismaProductionPackagingRepository().getBatchPackagingView(batchId),
  ]);
  if (!batch || !materialView || !packagingView || !batch.finishedGood.finishedGoodProfile)
    return null;
  const posted = batch.outputTransactions.filter((row) => row.status === "POSTED");
  const goodPieces = sum(
    posted.filter((row) => row.outputType === "GOOD"),
    "totalPieces",
  );
  const goodBreakdown = piecesToCartons(
    goodPieces,
    batch.finishedGood.finishedGoodProfile.piecesPerCarton,
  );
  const goodCartons = goodBreakdown.cartons;
  const goodLoose = goodBreakdown.loosePieces;
  const perPieceContent = new Decimal(batch.plannedProductContentNormalizedQuantity).div(
    batch.plannedTotalPieces,
  );
  const goodContent = perPieceContent.mul(goodPieces).toFixed();
  const reprocess = sum(
    posted.filter((row) => row.outputType === "REPROCESS"),
    "normalizedQuantity",
  );
  const rejected = sum(
    posted.filter((row) => row.outputType === "REJECTED"),
    "normalizedQuantity",
  );
  const loss = sum(
    posted.filter((row) => row.outputType === "PROCESS_LOSS"),
    "normalizedQuantity",
  );
  const inputs = await inputComponents(client, batchId);
  const reconciliation = calculateOutputReconciliation({
    basisDimension: batch.productContentCanonicalDimension,
    inputComponents: inputs,
    goodOutput: goodContent,
    reprocessOutput: reprocess,
    rejectedOutput: rejected,
    processLoss: loss,
    expectedYieldPercent: batch.expectedYieldPercent?.toString() ?? null,
  });
  const packaging = batch.packagingRequirements.map((requirement) => {
    const actual = packagingView.requirements.find((row) => row.requirementId === requirement.id)!;
    const finalStandard = calculateFinalPackagingStandard(
      requirement.usageBasis,
      requirement.packagingBomLine.normalizedQuantity.toString(),
      goodPieces,
      goodCartons,
    );
    const totalDepleted = new Decimal(actual.cumulativeGoodConsumed).add(actual.cumulativeDamaged);
    const goodVariance = new Decimal(actual.cumulativeGoodConsumed).sub(finalStandard);
    return {
      requirementId: requirement.id,
      itemCode: actual.itemCode,
      itemName: actual.itemName,
      usageBasis: requirement.usageBasis,
      plannedStandard: requirement.standardRequiredQuantity.toString(),
      finalStandard,
      recommendedIssue: requirement.recommendedIssueQuantity.toString(),
      goodConsumed: actual.cumulativeGoodConsumed,
      damaged: actual.cumulativeDamaged,
      returned: actual.cumulativeReturned,
      totalDepleted: totalDepleted.toFixed(),
      plannedVariance: actual.provisionalVarianceQuantity,
      finalVariance: totalDepleted.sub(finalStandard).toFixed(),
      goodConsumptionVariance: goodVariance.toFixed(),
      consistencyWarning: goodVariance.isZero()
        ? null
        : `${actual.itemCode} good consumption differs from actual-output standard by ${goodVariance.toFixed()} ${actual.canonicalUnitSymbol}.`,
      unitSymbol: actual.canonicalUnitSymbol,
    };
  });
  const custody = await custodyBalances(client, batchId);
  const blockers = [
    ...(posted.some((row) => row.outputType === "GOOD")
      ? []
      : ["Post at least one GOOD output transaction."]),
    ...(batch.outputTransactions.some((row) => row.status === "DRAFT")
      ? ["Post or cancel every output DRAFT."]
      : []),
    ...(custody.length ? ["Resolve all raw-material and packaging IN_PRODUCTION custody."] : []),
  ];
  const needsExplanation =
    !reconciliation.compatible ||
    (reconciliation.unreconciledDifference !== null &&
      !new Decimal(reconciliation.unreconciledDifference).isZero()) ||
    packaging.some((row) => row.consistencyWarning !== null);
  return {
    productionBatchId: batch.id,
    batchNumber: batch.batchNumber,
    batchStatus: batch.status,
    recipeCode: batch.recipe.code,
    recipeVersion: batch.recipeVersion,
    finishedGoodCode: batch.finishedGood.code,
    finishedGoodName: batch.finishedGood.name,
    piecesPerCarton: batch.finishedGood.finishedGoodProfile.piecesPerCarton,
    destinationWarehouseId: batch.finishedGoodsDestinationWarehouseId,
    destinationWarehouseName: batch.finishedGoodsDestinationWarehouse.name,
    productContentUnitId: batch.productContentCanonicalUnitId,
    productContentUnitSymbol: batch.productContentCanonicalUnit.symbol,
    productContentDimension: batch.productContentCanonicalDimension,
    expectedYieldPercent: batch.expectedYieldPercent?.toString() ?? null,
    plannedBatch: `${batch.plannedBatchEnteredQuantity} ${batch.plannedBatchUnit.symbol}`,
    plannedFinishedOutput: `${batch.plannedCartons} cartons + ${batch.plannedLoosePieces} loose / ${batch.plannedTotalPieces} pieces`,
    plannedExpectedOutput: batch.plannedExpectedOutputNormalizedQuantity
      ? `${batch.plannedExpectedOutputNormalizedQuantity} ${batch.expectedOutputCanonicalUnit?.symbol ?? ""}`
      : null,
    goodCartons,
    goodLoosePieces: goodLoose,
    goodTotalPieces: goodPieces,
    goodContent,
    reprocessOutput: reprocess,
    rejectedOutput: rejected,
    processLoss: loss,
    rawMaterials: materialView.requirements.map((row) => ({
      requirementId: row.requirementId,
      itemCode: row.itemCode,
      itemName: row.itemName,
      planned: row.plannedQuantity,
      issued: row.cumulativeIssued,
      returned: row.cumulativeReturned,
      consumed: row.cumulativeConsumed,
      variance: row.varianceQuantity,
      varianceDirection: row.varianceDirection,
      unitSymbol: row.canonicalUnitSymbol,
    })),
    inputComponents: inputs,
    reconciliation,
    packaging,
    productionLot: batch.productionLot,
    consumedSupplierLots: await consumedLots(client, batchId),
    transactions: batch.outputTransactions.map(mapTransaction),
    completionBlockers: blockers,
    completionNeedsExplanation: needsExplanation,
    completionExplanation: batch.completionExplanation,
    completedByName: batch.completedBy?.name ?? null,
    completedAt: batch.completedAt,
  };
}

async function completionSnapshot(client: Prisma.TransactionClient, batchId: string) {
  const batch = await client.productionBatch.findUnique({
    where: { id: batchId },
    select: {
      status: true,
      productContentCanonicalDimension: true,
      plannedProductContentNormalizedQuantity: true,
      plannedTotalPieces: true,
      expectedYieldPercent: true,
      finishedGood: { select: { finishedGoodProfile: { select: { piecesPerCarton: true } } } },
      outputTransactions: true,
      packagingRequirements: { include: { packagingBomLine: true } },
    },
  });
  if (!batch)
    throw new ProductionOutputRepositoryError("invalid-reference", "Production batch not found.");
  const custody = await custodyBalances(client, batchId);
  const posted = batch.outputTransactions.filter((row) => row.status === "POSTED");
  const goodPieces = sum(
    posted.filter((row) => row.outputType === "GOOD"),
    "totalPieces",
  );
  if (!batch.finishedGood.finishedGoodProfile)
    throw new ProductionOutputRepositoryError(
      "invalid-reference",
      "The batch finished good requires a quantity profile.",
    );
  const goodCartons = piecesToCartons(
    goodPieces,
    batch.finishedGood.finishedGoodProfile.piecesPerCarton,
  ).cartons;
  const goodContent = new Decimal(batch.plannedProductContentNormalizedQuantity)
    .div(batch.plannedTotalPieces)
    .mul(goodPieces)
    .toFixed();
  const reconciliation = calculateOutputReconciliation({
    basisDimension: batch.productContentCanonicalDimension,
    inputComponents: await inputComponents(client, batchId),
    goodOutput: goodContent,
    reprocessOutput: sum(
      posted.filter((row) => row.outputType === "REPROCESS"),
      "normalizedQuantity",
    ),
    rejectedOutput: sum(
      posted.filter((row) => row.outputType === "REJECTED"),
      "normalizedQuantity",
    ),
    processLoss: sum(
      posted.filter((row) => row.outputType === "PROCESS_LOSS"),
      "normalizedQuantity",
    ),
    expectedYieldPercent: batch.expectedYieldPercent?.toString() ?? null,
  });
  const packagingActual = await packagingAggregates(client, batchId);
  const packagingMismatch = batch.packagingRequirements.some((line) => {
    const consumed = packagingActual.get(line.id) ?? "0";
    const standard = calculateFinalPackagingStandard(
      line.usageBasis,
      line.packagingBomLine.normalizedQuantity.toString(),
      goodPieces,
      goodCartons,
    );
    return !new Decimal(consumed).eq(standard);
  });
  return {
    status: batch.status,
    blockers: [
      ...(posted.some((row) => row.outputType === "GOOD")
        ? []
        : ["Post at least one GOOD output transaction."]),
      ...(batch.outputTransactions.some((row) => row.status === "DRAFT")
        ? ["Post or cancel every output DRAFT."]
        : []),
      ...(custody.length ? ["Resolve all IN_PRODUCTION custody before completion."] : []),
    ],
    needsExplanation:
      !reconciliation.compatible ||
      (reconciliation.unreconciledDifference !== null &&
        !new Decimal(reconciliation.unreconciledDifference).isZero()) ||
      packagingMismatch,
  };
}

async function inputComponents(client: Prisma.TransactionClient | typeof prisma, batchId: string) {
  const rows = await client.inventoryMovement.groupBy({
    by: ["canonicalUnitId"],
    where: {
      productionBatchId: batchId,
      movementType: "PRODUCTION_CONSUMPTION",
      status: "IN_PRODUCTION",
      quantity: { lt: 0 },
    },
    _sum: { quantity: true },
  });
  const units = await client.unit.findMany({
    where: { id: { in: rows.map((row) => row.canonicalUnitId) } },
  });
  return rows.map((row) => {
    const unit = units.find((candidate) => candidate.id === row.canonicalUnitId)!;
    return {
      dimension: unit.dimension,
      quantity: new Decimal(row._sum.quantity?.toString() ?? 0).abs().toFixed(),
      unitSymbol: unit.symbol,
    };
  });
}

async function custodyBalances(client: Prisma.TransactionClient | typeof prisma, batchId: string) {
  const rows = await client.inventoryMovement.groupBy({
    by: ["itemId", "warehouseId", "canonicalUnitId", "inventoryLotId"],
    where: { productionBatchId: batchId, status: "IN_PRODUCTION" },
    _sum: { quantity: true },
  });
  return rows.filter((row) => !new Decimal(row._sum.quantity?.toString() ?? 0).isZero());
}

async function packagingAggregates(client: Prisma.TransactionClient, batchId: string) {
  const rows = await client.productionMaterialTransactionLine.groupBy({
    by: ["packagingRequirementId"],
    where: {
      packagingRequirementId: { not: null },
      transaction: {
        productionBatchId: batchId,
        materialType: "PACKAGING_MATERIAL",
        transactionType: "CONSUMPTION",
        status: "POSTED",
      },
    },
    _sum: { normalizedQuantity: true },
  });
  return new Map(
    rows.map((row) => [
      row.packagingRequirementId!,
      row._sum.normalizedQuantity?.toString() ?? "0",
    ]),
  );
}

async function consumedLots(client: typeof prisma, batchId: string) {
  const rows = await client.inventoryMovement.groupBy({
    by: ["itemId", "inventoryLotId", "canonicalUnitId"],
    where: {
      productionBatchId: batchId,
      movementType: "PRODUCTION_CONSUMPTION",
      quantity: { lt: 0 },
      inventoryLotId: { not: null },
    },
    _sum: { quantity: true },
  });
  const [items, lots, units] = await Promise.all([
    client.item.findMany({ where: { id: { in: rows.map((row) => row.itemId) } } }),
    client.inventoryLot.findMany({
      where: { id: { in: rows.map((row) => row.inventoryLotId!) } },
      include: { supplier: true, sourceGoodsReceipt: true },
    }),
    client.unit.findMany({ where: { id: { in: rows.map((row) => row.canonicalUnitId) } } }),
  ]);
  return rows.map((row) => {
    const item = items.find((candidate) => candidate.id === row.itemId)!;
    const lot = lots.find((candidate) => candidate.id === row.inventoryLotId)!;
    const unit = units.find((candidate) => candidate.id === row.canonicalUnitId)!;
    return {
      itemCode: item.code,
      itemName: item.name,
      supplierName: lot.supplier.name,
      supplierLotNumber: lot.supplierLotNumber,
      goodsReceiptNumber: lot.sourceGoodsReceipt.number,
      consumedQuantity: new Decimal(row._sum.quantity?.toString() ?? 0).abs().toFixed(),
      unitSymbol: unit.symbol,
    };
  });
}

function sum<T extends Record<string, unknown>>(rows: readonly T[], key: keyof T) {
  return rows.reduce((total, row) => total.add(String(row[key] ?? 0)), new Decimal(0)).toFixed();
}

function mapTransaction(row: OutputRow): OutputTransactionRecord {
  return {
    id: row.id,
    outputNumber: row.outputNumber,
    productionBatchId: row.productionBatchId,
    outputType: row.outputType,
    transactionDate: row.transactionDate,
    status: row.status,
    cartons: row.cartons?.toString() ?? null,
    loosePieces: row.loosePieces?.toString() ?? null,
    totalPieces: row.totalPieces?.toString() ?? null,
    enteredQuantity: row.enteredQuantity?.toString() ?? null,
    enteredUnitId: row.enteredUnitId,
    enteredUnitSymbol: row.enteredUnit?.symbol ?? null,
    normalizedQuantity: row.normalizedQuantity?.toString() ?? null,
    canonicalUnitId: row.canonicalUnitId,
    canonicalUnitSymbol: row.canonicalUnit?.symbol ?? null,
    canonicalUnitDimension: row.canonicalUnitDimension,
    productionDate: row.productionDate,
    expiryDate: row.expiryDate,
    destinationWarehouseId: row.destinationWarehouseId,
    destinationWarehouseName: row.destinationWarehouse.name,
    productionLotId: row.productionLotId,
    productionLotNumber: row.productionLot?.lotNumber ?? null,
    lossReason: row.lossReason,
    lossNature: row.lossNature,
    notes: row.notes,
    createdByName: row.createdBy.name,
    postedByName: row.postedBy?.name ?? null,
    postedAt: row.postedAt,
  };
}

async function nextNumber(transaction: Prisma.TransactionClient) {
  const year = new Date().getUTCFullYear();
  const sequence = await transaction.productionOutputSequence.upsert({
    where: { year },
    create: { year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  const value = sequence.nextValue - 1;
  if (value > 999999)
    throw new ProductionOutputRepositoryError("conflict", "Annual output sequence is exhausted.");
  return `PO-${year}-${String(value).padStart(6, "0")}`;
}

function parseDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()))
    throw new ProductionOutputRepositoryError("invalid-reference", "Transaction date is invalid.");
  return date;
}
function parseDate(value: string, label: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
    throw new ProductionOutputRepositoryError("invalid-reference", `${label} is invalid.`);
  return date;
}
async function validateActor(transaction: Prisma.TransactionClient, actorUserId: string) {
  if ((await transaction.user.count({ where: { id: actorUserId, active: true } })) !== 1)
    throw new ProductionOutputRepositoryError("invalid-reference", "Acting user is inactive.");
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
  throw new ProductionOutputRepositoryError("conflict", "Production output conflict; retry.");
}
function mapError(error: unknown) {
  if (error instanceof ProductionOutputRepositoryError) return error;
  if (error instanceof InventoryRepositoryError)
    return new ProductionOutputRepositoryError(
      error.reason === "reference" ? "invalid-reference" : "conflict",
      error.message,
    );
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ["P2002", "P2003", "P2004"].includes(error.code)
  )
    return new ProductionOutputRepositoryError(
      error.code === "P2002" ? "conflict" : "invalid-reference",
      "Output conflicts with protected production or inventory data.",
    );
  return error instanceof Error
    ? error
    : new ProductionOutputRepositoryError("conflict", "Production output failed.");
}
