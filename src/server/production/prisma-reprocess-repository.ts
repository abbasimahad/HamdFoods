import "server-only";

import Decimal from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import type {
  ReprocessDraftInput,
  ReprocessDraftMetadataInput,
  ReprocessQualityDecisionInput,
  ReprocessRepository,
} from "@/modules/production/application/reprocess-contracts";
import { ReprocessRepositoryError } from "@/modules/production/application/reprocess-contracts";
import {
  calculateReprocessChildExpiry,
  reconcileReprocessYield,
  validateReprocessEligibility,
  validateReprocessQualityAuthority,
} from "@/modules/production/domain/reprocess";
import { convertQuantity } from "@/modules/quantity/domain/quantity";
import { recordAuditEvent } from "@/server/audit/audit-event";
import { valueReprocessConsumption } from "@/server/costing/prisma-inventory-valuation-repository";
import { prisma } from "@/server/db/prisma";
import {
  postReprocessConsumptionInventory,
  postReprocessQualityInventory,
  postReprocessReservationInventory,
} from "@/server/inventory/transactional-inventory-posting";
import {
  createPreparedProductionBatch,
  prepareProductionBatch,
} from "./prisma-production-batch-repository";

export class PrismaReprocessRepository implements ReprocessRepository {
  async listDocuments() {
    return prisma.reprocessDocument.findMany({
      include: {
        finishedGood: true,
        sourceWarehouse: true,
        childProductionLot: true,
        linkedProductionBatch: true,
        initiatedBy: true,
        qcDecision: { include: { inspectedBy: true } },
      },
      orderBy: [{ documentDate: "desc" }, { documentNumber: "desc" }],
      take: 200,
    });
  }

  async getDocument(id: string) {
    return prisma.reprocessDocument.findUnique({
      where: { id },
      include: {
        finishedGood: true,
        sourceWarehouse: true,
        sourceContributions: {
          include: {
            sourceProductionLot: true,
            sourceWasteDispositionLine: { include: { disposition: true } },
          },
          orderBy: { position: "asc" },
        },
        childProductionLot: true,
        linkedProductionBatch: { include: { productionCostSnapshot: true } },
        initiatedBy: true,
        completedBy: true,
        cancelledBy: true,
        qcDecision: { include: { inspectedBy: true } },
      },
    });
  }

  async listEligibleSources() {
    const balances = await prisma.inventoryMovement.groupBy({
      by: ["productionLotId", "warehouseId", "canonicalUnitId"],
      where: { status: "REPROCESS", productionLotId: { not: null } },
      _sum: { quantity: true },
    });
    const positive = balances.filter((row) =>
      new Decimal(row._sum.quantity?.toString() ?? "0").gt(0),
    );
    const [lots, warehouses, units] = await Promise.all([
      prisma.productionLot.findMany({
        where: {
          id: { in: positive.flatMap((row) => (row.productionLotId ? [row.productionLotId] : [])) },
        },
        include: { finishedGood: { include: { finishedGoodProfile: true } } },
      }),
      prisma.warehouse.findMany({ where: { id: { in: positive.map((row) => row.warehouseId) } } }),
      prisma.unit.findMany({ where: { id: { in: positive.map((row) => row.canonicalUnitId) } } }),
    ]);
    return positive.flatMap((row) => {
      const lot = lots.find((candidate) => candidate.id === row.productionLotId);
      const warehouse = warehouses.find((candidate) => candidate.id === row.warehouseId);
      const unit = units.find((candidate) => candidate.id === row.canonicalUnitId);
      return lot && warehouse && unit
        ? [
            {
              productionLotId: lot.id,
              lotNumber: lot.lotNumber,
              itemId: lot.finishedGoodId,
              itemCode: lot.finishedGood.code,
              itemName: lot.finishedGood.name,
              warehouseId: warehouse.id,
              warehouseCode: warehouse.code,
              unitId: unit.id,
              unitSymbol: unit.symbol,
              quantity: row._sum.quantity!.toString(),
              expiryDate: lot.expiryDate,
              shelfLifeDays: lot.finishedGood.finishedGoodProfile?.reprocessShelfLifeDays ?? null,
            },
          ]
        : [];
    });
  }

  async createDraft(input: ReprocessDraftInput) {
    const prepared = await prepareProductionBatch(input);
    return serializable(async (transaction) => {
      const source = await loadSource(transaction, input);
      if (prepared.header.finishedGoodId !== source.finishedGoodId)
        throw new ReprocessRepositoryError(
          "invalid-reference",
          "The linked recipe must produce the same finished good as the source lot.",
        );
      const available = await sourceBalance(transaction, input);
      const snapshot = validateReprocessEligibility({
        itemType: source.finishedGood.itemType,
        sourceStatus: "REPROCESS",
        requestedQuantity: input.sourceQuantity,
        eligibleQuantity: available,
        sourceExpiry: source.expiryDate,
        reprocessShelfLifeDays:
          source.finishedGood.finishedGoodProfile?.reprocessShelfLifeDays ?? null,
        today: new Date(),
      });
      const sourceUnit = await transaction.unit.findFirst({
        where: { id: input.sourceUnitId, active: true },
      });
      if (!sourceUnit)
        throw new ReprocessRepositoryError(
          "invalid-reference",
          "The source quantity unit is invalid.",
        );
      const contentUnit = await transaction.unit.findUniqueOrThrow({
        where: { id: prepared.header.productContentCanonicalUnitId },
      });
      const normalizedContent = sourceContentQuantity(
        snapshot.requestedQuantity,
        sourceUnit,
        contentUnit,
        source.productionBatch.plannedTotalPieces.toString(),
        source.productionBatch.plannedProductContentNormalizedQuantity.toString(),
      );
      const batchId = await createPreparedProductionBatch(
        transaction,
        input,
        prepared,
        "REPROCESS",
      );
      const documentNumber = await nextDocumentNumber(transaction);
      const document = await transaction.reprocessDocument.create({
        data: {
          documentNumber,
          documentDate: utcDateOnly(new Date()),
          finishedGoodId: source.finishedGoodId,
          sourceWarehouseId: input.sourceWarehouseId,
          linkedProductionBatchId: batchId,
          reason: input.reason,
          notes: input.notes ?? null,
          shelfLifeDaysSnapshot: snapshot.shelfLifeDaysSnapshot,
          sourceExpirySnapshot: snapshot.sourceExpirySnapshot,
          netContentQuantitySnapshot: perPieceContent(
            source.productionBatch.plannedTotalPieces.toString(),
            source.productionBatch.plannedProductContentNormalizedQuantity.toString(),
          ),
          initiatedByUserId: input.actorUserId,
          sourceContributions: {
            create: {
              position: 1,
              sourceProductionLotId: source.id,
              sourceInventoryMovementId: source.sourceMovementId,
              sourceWasteDispositionLineId: source.sourceWasteDispositionLineId,
              sourceStatus: "REPROCESS",
              enteredQuantity: snapshot.requestedQuantity,
              enteredUnitId: sourceUnit.id,
              enteredUnitDimension: sourceUnit.dimension,
              normalizedContentQuantity: normalizedContent,
              contentCanonicalUnitId: contentUnit.id,
              contentCanonicalDimension: contentUnit.dimension,
              sourceExpirySnapshot: snapshot.sourceExpirySnapshot,
            },
          },
        },
      });
      await recordAuditEvent(transaction, {
        actorUserId: input.actorUserId,
        action: "CREATE",
        entityType: "REPROCESS_DOCUMENT",
        entityId: document.id,
        entityReference: documentNumber,
        module: "production",
        description: `Created reprocess document ${documentNumber} with linked batch.`,
        afterSnapshot: {
          status: "DRAFT",
          sourceProductionLotId: source.id,
          sourceQuantity: snapshot.requestedQuantity,
          linkedProductionBatchId: batchId,
          shelfLifeDaysSnapshot: snapshot.shelfLifeDaysSnapshot,
          sourceExpirySnapshot: snapshot.sourceExpirySnapshot.toISOString(),
        },
        controlEvent: true,
      });
      return document.id;
    });
  }

  async updateDraftMetadata(input: ReprocessDraftMetadataInput) {
    await serializable(async (transaction) => {
      const document = await transaction.reprocessDocument.findUnique({ where: { id: input.id } });
      if (!document)
        throw new ReprocessRepositoryError("not-found", "Reprocess document was not found.");
      if (document.status !== "DRAFT")
        throw new ReprocessRepositoryError(
          "invalid-state",
          "Only a DRAFT Reprocess document can be edited.",
        );
      const actor = await transaction.user.count({
        where: { id: input.actorUserId, active: true },
      });
      if (actor !== 1)
        throw new ReprocessRepositoryError("invalid-reference", "The acting user is not active.");
      await transaction.reprocessDocument.update({
        where: { id: input.id },
        data: { reason: input.reason, notes: input.notes ?? null },
      });
      await transaction.productionBatch.update({
        where: { id: document.linkedProductionBatchId },
        data: { notes: input.notes ?? null },
      });
      await recordAuditEvent(transaction, {
        actorUserId: input.actorUserId,
        action: "UPDATE",
        entityType: "REPROCESS_DOCUMENT",
        entityId: document.id,
        entityReference: document.documentNumber,
        module: "production",
        description: `Updated draft metadata for ${document.documentNumber}.`,
        beforeSnapshot: { reason: document.reason, notes: document.notes },
        afterSnapshot: { reason: input.reason, notes: input.notes ?? null },
        controlEvent: true,
      });
    });
  }

  async reserve(id: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const document = await transaction.reprocessDocument.findUnique({
        where: { id },
        include: { sourceContributions: true },
      });
      if (!document)
        throw new ReprocessRepositoryError("not-found", "Reprocess document was not found.");
      if (document.status !== "DRAFT")
        throw new ReprocessRepositoryError(
          "invalid-state",
          "Only a DRAFT reprocess can be reserved.",
        );
      const actor = await transaction.user.count({ where: { id: actorUserId, active: true } });
      if (actor !== 1)
        throw new ReprocessRepositoryError("invalid-reference", "The acting user is inactive.");
      for (const contribution of document.sourceContributions) {
        const groupId = await postReprocessReservationInventory(transaction, {
          operation: "RESERVE",
          reprocessDocumentId: document.id,
          documentNumber: document.documentNumber,
          contributionId: contribution.id,
          itemId: document.finishedGoodId,
          warehouseId: document.sourceWarehouseId,
          canonicalUnitId: contribution.enteredUnitId,
          productionLotId: contribution.sourceProductionLotId,
          quantity: contribution.enteredQuantity.toString(),
          actorUserId,
        });
        await transaction.reprocessSourceContribution.update({
          where: { id: contribution.id },
          data: { reservationGroupId: groupId },
        });
      }
      await transaction.reprocessDocument.update({ where: { id }, data: { status: "RESERVED" } });
      await recordAuditEvent(transaction, {
        actorUserId,
        action: "UPDATE",
        entityType: "REPROCESS_DOCUMENT",
        entityId: id,
        entityReference: document.documentNumber,
        module: "production",
        description: `Reserved source inventory for ${document.documentNumber}.`,
        beforeSnapshot: { status: "DRAFT" },
        afterSnapshot: { status: "RESERVED" },
        controlEvent: true,
      });
    });
  }

  async start(id: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const document = await transaction.reprocessDocument.findUnique({
        where: { id },
        include: { sourceContributions: true, linkedProductionBatch: true },
      });
      if (!document)
        throw new ReprocessRepositoryError("not-found", "Reprocess document was not found.");
      if (document.status !== "RESERVED" || document.linkedProductionBatch.status !== "DRAFT")
        throw new ReprocessRepositoryError(
          "invalid-state",
          "Only a RESERVED reprocess with an untouched linked batch can be started.",
        );
      const actor = await transaction.user.count({ where: { id: actorUserId, active: true } });
      if (actor !== 1)
        throw new ReprocessRepositoryError("invalid-reference", "The acting user is inactive.");
      const valuationIds: string[] = [];
      let sourceValue = new Decimal(0);
      const startedAt = new Date();
      for (const contribution of document.sourceContributions) {
        await postReprocessConsumptionInventory(transaction, {
          reprocessDocumentId: document.id,
          documentNumber: document.documentNumber,
          contributionId: contribution.id,
          productionBatchId: document.linkedProductionBatchId,
          itemId: document.finishedGoodId,
          warehouseId: document.sourceWarehouseId,
          canonicalUnitId: contribution.enteredUnitId,
          productionLotId: contribution.sourceProductionLotId,
          quantity: contribution.enteredQuantity.toString(),
          actorUserId,
        });
        const valuation = await valueReprocessConsumption(
          transaction,
          contribution.id,
          actorUserId,
        );
        valuationIds.push(valuation.id);
        sourceValue = sourceValue.add(new Decimal(valuation.valueDelta?.toString() ?? "0").abs());
        await transaction.reprocessSourceContribution.update({
          where: { id: contribution.id },
          data: { startedAt },
        });
      }
      await transaction.productionBatch.update({
        where: { id: document.linkedProductionBatchId },
        data: { status: "PLANNED" },
      });
      await transaction.productionBatch.update({
        where: { id: document.linkedProductionBatchId },
        data: { status: "RELEASED", releasedByUserId: actorUserId, releasedAt: startedAt },
      });
      await transaction.productionBatch.update({
        where: { id: document.linkedProductionBatchId },
        data: { status: "IN_PROGRESS" },
      });
      await transaction.reprocessDocument.update({
        where: { id },
        data: { status: "IN_PROGRESS" },
      });
      await recordAuditEvent(transaction, {
        actorUserId,
        action: "POST",
        entityType: "REPROCESS_DOCUMENT",
        entityId: id,
        entityReference: document.documentNumber,
        module: "production",
        description: `Consumed source finished good into WIP for ${document.documentNumber}.`,
        metadata: {
          linkedProductionBatchId: document.linkedProductionBatchId,
          valuationIds,
          sourceValue: sourceValue.toFixed(6),
        },
        beforeSnapshot: { status: "RESERVED", batchStatus: "DRAFT" },
        afterSnapshot: { status: "IN_PROGRESS", batchStatus: "IN_PROGRESS" },
        controlEvent: true,
      });
    });
  }

  async cancel(id: string, actorUserId: string, reason: string) {
    await serializable(async (transaction) => {
      const document = await transaction.reprocessDocument.findUnique({
        where: { id },
        include: { sourceContributions: true, linkedProductionBatch: true },
      });
      if (!document)
        throw new ReprocessRepositoryError("not-found", "Reprocess document was not found.");
      if (document.status !== "DRAFT" && document.status !== "RESERVED")
        throw new ReprocessRepositoryError(
          "invalid-state",
          "Only a DRAFT or RESERVED reprocess can be cancelled.",
        );
      if (document.linkedProductionBatch.status !== "DRAFT")
        throw new ReprocessRepositoryError(
          "invalid-state",
          "The linked production batch has activity and cannot be cancelled here.",
        );
      if (document.status === "RESERVED") {
        for (const contribution of document.sourceContributions)
          await postReprocessReservationInventory(transaction, {
            operation: "RELEASE",
            reprocessDocumentId: document.id,
            documentNumber: document.documentNumber,
            contributionId: contribution.id,
            itemId: document.finishedGoodId,
            warehouseId: document.sourceWarehouseId,
            canonicalUnitId: contribution.enteredUnitId,
            productionLotId: contribution.sourceProductionLotId,
            quantity: contribution.enteredQuantity.toString(),
            actorUserId,
          });
      }
      const now = new Date();
      await transaction.productionBatch.update({
        where: { id: document.linkedProductionBatchId },
        data: {
          status: "CANCELLED",
          cancelledByUserId: actorUserId,
          cancelledAt: now,
          cancellationReason: reason,
        },
      });
      await transaction.reprocessDocument.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledByUserId: actorUserId,
          cancelledAt: now,
          cancellationReason: reason,
        },
      });
      await recordAuditEvent(transaction, {
        actorUserId,
        action: "CANCEL",
        entityType: "REPROCESS_DOCUMENT",
        entityId: id,
        entityReference: document.documentNumber,
        module: "production",
        description: `Cancelled reprocess ${document.documentNumber}.`,
        reason,
        beforeSnapshot: { status: document.status },
        afterSnapshot: { status: "CANCELLED" },
        controlEvent: true,
      });
    });
  }

  async decideQuality(input: ReprocessQualityDecisionInput) {
    await serializable(async (transaction) => {
      const document = await transaction.reprocessDocument.findUnique({
        where: { id: input.id },
        include: {
          sourceContributions: true,
          childProductionLot: true,
          linkedProductionBatch: {
            include: {
              productionCostSnapshot: true,
              outputTransactions: {
                where: { status: "POSTED", outputType: "GOOD" },
                include: { inventoryMovements: true },
              },
            },
          },
          qcDecision: true,
        },
      });
      if (!document)
        throw new ReprocessRepositoryError("not-found", "Reprocess document was not found.");
      if (document.status !== "AWAITING_QC" || document.qcDecision)
        throw new ReprocessRepositoryError(
          "invalid-state",
          "Only an undecided AWAITING_QC reprocess result can be reviewed.",
        );
      const qualityUser = await transaction.user.findFirst({
        where: {
          id: input.actorUserId,
          active: true,
          roles: {
            some: {
              role: {
                permissions: { some: { permission: { code: "quality.manage" } } },
              },
            },
          },
        },
      });
      if (!qualityUser)
        throw new ReprocessRepositoryError(
          "invalid-reference",
          "Reprocess quality management permission is required.",
        );
      if (!document.completedByUserId)
        throw new ReprocessRepositoryError(
          "invalid-state",
          "Reprocess completion actor is missing.",
        );
      validateReprocessQualityAuthority(
        input.actorUserId,
        document.initiatedByUserId,
        document.completedByUserId,
      );
      const batch = document.linkedProductionBatch;
      const snapshot = batch.productionCostSnapshot;
      if (
        batch.status !== "COMPLETED" ||
        !snapshot ||
        snapshot.status !== "FINALIZED" ||
        !document.childProductionLot ||
        !document.childExpiry ||
        !document.completionDate ||
        document.childProductionLot.expiryDate?.valueOf() !== document.childExpiry.valueOf() ||
        document.childProductionLot.productionDate.valueOf() !== document.completionDate.valueOf()
      )
        throw new ReprocessRepositoryError(
          "invalid-state",
          "Reprocess QC requires completed, cost-finalized, date-consistent child genealogy.",
        );
      const expectedExpiry = calculateReprocessChildExpiry(
        document.completionDate,
        document.shelfLifeDaysSnapshot,
        document.sourceExpirySnapshot,
      );
      if (expectedExpiry.valueOf() !== document.childExpiry.valueOf())
        throw new ReprocessRepositoryError(
          "invalid-state",
          "The child lot expiry no longer matches the frozen Reprocess policy.",
        );
      reconcileReprocessYield({
        source: document.sourceContentConsumed?.toString() ?? "0",
        good: document.goodContentOutput?.toString() ?? "0",
        scrap: document.scrapContentOutput?.toString() ?? "0",
        processLoss: document.processLossContent?.toString() ?? "0",
      });
      const goodQuantity = batch.outputTransactions.reduce(
        (total, output) => total.add(output.totalPieces?.toString() ?? "0"),
        new Decimal(0),
      );
      const outputMovement = batch.outputTransactions[0]?.inventoryMovements.find(
        (movement) => movement.movementType === "PRODUCTION_OUTPUT",
      );
      if (!outputMovement)
        throw new ReprocessRepositoryError(
          "invalid-state",
          "Reprocess QC requires an authoritative posted child-lot output movement.",
        );
      const outputValuations = await transaction.inventoryValuationEntry.findMany({
        where: {
          productionBatchId: batch.id,
          productionLotId: document.childProductionLot.id,
          entryType: "REPROCESS_OUTPUT",
        },
      });
      const finalJournal = await transaction.accountingJournal.findUnique({
        where: {
          sourceType_sourceId: { sourceType: "PRODUCTION_OUTPUT", sourceId: snapshot.id },
        },
      });
      if (
        goodQuantity.lte(0) ||
        outputValuations.length !== batch.outputTransactions.length ||
        outputValuations.some((entry) => entry.state !== "FINAL" || entry.valueDelta === null) ||
        !finalJournal ||
        finalJournal.status !== "POSTED" ||
        !new Decimal(finalJournal.totalDebit).eq(finalJournal.totalCredit)
      )
        throw new ReprocessRepositoryError(
          "invalid-state",
          "Reprocess QC requires finalized output valuation and balanced accounting.",
        );
      const reason =
        input.decision === "APPROVED"
          ? `Quality approved and released ${document.documentNumber}.`
          : `Quality rejected ${document.documentNumber}: ${input.rejectionReason}.`;
      await postReprocessQualityInventory(transaction, {
        reprocessDocumentId: document.id,
        documentNumber: document.documentNumber,
        childProductionLotId: document.childProductionLot.id,
        productionBatchId: batch.id,
        itemId: document.finishedGoodId,
        warehouseId: batch.finishedGoodsDestinationWarehouseId,
        canonicalUnitId: outputMovement.canonicalUnitId,
        quantity: goodQuantity.toFixed(),
        decision: input.decision,
        reason,
        actorUserId: input.actorUserId,
      });
      await transaction.reprocessQcDecision.create({
        data: {
          reprocessDocumentId: document.id,
          childProductionLotId: document.childProductionLot.id,
          decision: input.decision,
          rejectionReason: input.decision === "REJECTED" ? input.rejectionReason! : null,
          notes: input.notes ?? null,
          inspectedByUserId: input.actorUserId,
        },
      });
      const status = input.decision === "APPROVED" ? "RELEASED" : "REJECTED";
      await transaction.reprocessDocument.update({ where: { id: document.id }, data: { status } });
      await recordAuditEvent(transaction, {
        actorUserId: input.actorUserId,
        action: input.decision === "APPROVED" ? "APPROVE" : "UPDATE",
        entityType: "REPROCESS_DOCUMENT",
        entityId: document.id,
        entityReference: document.documentNumber,
        module: "quality",
        description: reason,
        reason: input.notes ?? null,
        metadata: {
          decision: input.decision,
          rejectionReason: input.rejectionReason ?? null,
          childProductionLotId: document.childProductionLot.id,
          quantity: goodQuantity.toFixed(),
        },
        beforeSnapshot: { status: "AWAITING_QC", inventoryStatus: "QUALITY_HOLD" },
        afterSnapshot: {
          status,
          inventoryStatus: input.decision === "APPROVED" ? "AVAILABLE" : "QUARANTINE",
        },
        controlEvent: true,
      });
    });
  }
}

async function loadSource(transaction: Prisma.TransactionClient, input: ReprocessDraftInput) {
  const source = await transaction.productionLot.findFirst({
    where: {
      id: input.sourceProductionLotId,
      finishedGood: { itemType: "FINISHED_GOOD", active: true },
    },
    include: {
      finishedGood: { include: { finishedGoodProfile: true } },
      productionBatch: true,
    },
  });
  if (!source)
    throw new ReprocessRepositoryError(
      "invalid-reference",
      "Select an active finished-good production lot.",
    );
  const sourceMovement = await transaction.inventoryMovement.findFirst({
    where: {
      productionLotId: source.id,
      warehouseId: input.sourceWarehouseId,
      canonicalUnitId: input.sourceUnitId,
      status: "REPROCESS",
      quantity: { gt: 0 },
    },
    orderBy: [{ postedAt: "desc" }, { id: "desc" }],
    select: { id: true, wasteDispositionLineId: true },
  });
  if (!sourceMovement)
    throw new ReprocessRepositoryError(
      "stock",
      "The source lot has no eligible REPROCESS custody in the selected warehouse and unit.",
    );
  return {
    ...source,
    sourceMovementId: sourceMovement.id,
    sourceWasteDispositionLineId: sourceMovement.wasteDispositionLineId,
  };
}

async function sourceBalance(transaction: Prisma.TransactionClient, input: ReprocessDraftInput) {
  const row = await transaction.inventoryMovement.aggregate({
    where: {
      productionLotId: input.sourceProductionLotId,
      warehouseId: input.sourceWarehouseId,
      canonicalUnitId: input.sourceUnitId,
      status: "REPROCESS",
    },
    _sum: { quantity: true },
  });
  return row._sum.quantity?.toString() ?? "0";
}

function sourceContentQuantity(
  quantity: string,
  sourceUnit: { code: string; symbol: string; dimension: "MASS" | "VOLUME" | "COUNT" },
  contentUnit: { code: string; symbol: string; dimension: "MASS" | "VOLUME" | "COUNT" },
  sourcePieces: string,
  sourceContent: string,
) {
  if (sourceUnit.dimension === contentUnit.dimension)
    return convertQuantity(
      { amount: quantity, unit: { ...sourceUnit, active: true } },
      { ...contentUnit, active: true },
    ).amount;
  if (sourceUnit.dimension !== "COUNT")
    throw new ReprocessRepositoryError(
      "invalid-reference",
      "The source custody unit is incompatible with the finished good's content unit.",
    );
  return new Decimal(quantity).mul(perPieceContent(sourcePieces, sourceContent)).toFixed();
}

function perPieceContent(pieces: string, content: string) {
  const pieceCount = new Decimal(pieces);
  if (!pieceCount.isInteger() || pieceCount.lte(0))
    throw new ReprocessRepositoryError(
      "invalid-reference",
      "The source lot does not have a valid per-piece content basis.",
    );
  return new Decimal(content).div(pieceCount).toFixed();
}

async function nextDocumentNumber(transaction: Prisma.TransactionClient) {
  const year = new Date().getUTCFullYear();
  const sequence = await transaction.reprocessDocumentSequence.upsert({
    where: { year },
    create: { year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  const value = sequence.nextValue - 1;
  if (value > 999999)
    throw new ReprocessRepositoryError("conflict", "Annual reprocess sequence is exhausted.");
  return `RP-${year}-${String(value).padStart(6, "0")}`;
}

function utcDateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
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
  throw new ReprocessRepositoryError("conflict", "Reprocess conflict; retry.");
}

function mapError(error: unknown) {
  if (error instanceof ReprocessRepositoryError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return new ReprocessRepositoryError(
        "conflict",
        "This reprocess operation was already posted.",
      );
    if (["P2003", "P2004"].includes(error.code))
      return new ReprocessRepositoryError(
        "invalid-reference",
        "Reprocess data conflicts with protected inventory or production references.",
      );
  }
  return error instanceof Error
    ? error
    : new ReprocessRepositoryError("conflict", "Reprocess operation failed.");
}
