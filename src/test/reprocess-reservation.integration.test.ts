import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { PrismaReprocessRepository } from "@/server/production/prisma-reprocess-repository";
import { PrismaProductionBatchRepository } from "@/server/production/prisma-production-batch-repository";
import { PrismaProductionMaterialRepository } from "@/server/production/prisma-production-material-repository";
import { PrismaProductionPackagingRepository } from "@/server/production/prisma-production-packaging-repository";
import { PrismaProductionOutputRepository } from "@/server/production/prisma-production-output-repository";
import { PrismaInventoryValuationRepository } from "@/server/costing/prisma-inventory-valuation-repository";
import { PrismaWasteDispositionRepository } from "@/server/inventory/prisma-waste-disposition-repository";
import { executePhase27GoldenWorkflow } from "./phase27-golden-workflow";

describe("reprocess draft and reservation", () => {
  it("creates one linked batch, reserves competitively, and releases a cancellation once", async () => {
    const state = await executePhase27GoldenWorkflow();
    const grams = await prisma.unit.findUniqueOrThrow({ where: { code: "G" } });
    const lot = await prisma.productionLot.findUniqueOrThrow({
      where: { id: state.productionLotId },
    });
    await prisma.finishedGoodProfile.update({
      where: { itemId: state.finishedItemId },
      data: { reprocessShelfLifeDays: 60 },
    });
    const groupId = randomUUID();
    await prisma.inventoryMovement.createMany({
      data: [
        {
          itemId: state.finishedItemId,
          warehouseId: state.sourceWarehouseId,
          status: "AVAILABLE",
          quantity: "-50",
          canonicalUnitId: grams.id,
          movementType: "STATUS_OUT",
          referenceType: "TEST_REPROCESS_FIXTURE",
          referenceId: groupId,
          sourceKey: `${groupId}:OUT`,
          groupId,
          reason: "Integration fixture puts traceable finished lot into reprocess custody.",
          createdByUserId: state.actorUserId,
          productionLotId: state.productionLotId,
        },
        {
          itemId: state.finishedItemId,
          warehouseId: state.sourceWarehouseId,
          status: "REPROCESS",
          quantity: "50",
          canonicalUnitId: grams.id,
          movementType: "STATUS_IN",
          referenceType: "TEST_REPROCESS_FIXTURE",
          referenceId: groupId,
          sourceKey: `${groupId}:IN`,
          groupId,
          reason: "Integration fixture puts traceable finished lot into reprocess custody.",
          createdByUserId: state.actorUserId,
          productionLotId: state.productionLotId,
        },
      ],
    });

    const repository = new PrismaReprocessRepository();
    const draftInput = {
      sourceProductionLotId: state.productionLotId,
      sourceWarehouseId: state.sourceWarehouseId,
      sourceQuantity: "30",
      sourceUnitId: grams.id,
      recipeId: state.recipeId,
      plannedBatchQuantity: "1000",
      plannedBatchUnitId: grams.id,
      plannedProductionDate: "2026-09-12",
      targetCompletionDate: "2026-09-13",
      rawMaterialWarehouseId: state.sourceWarehouseId,
      packagingWarehouseId: state.sourceWarehouseId,
      finishedGoodsDestinationWarehouseId: state.sourceWarehouseId,
      plannedCartons: "0",
      plannedLoosePieces: "2",
      reason: "Controlled reprocess reservation integration test.",
      actorUserId: state.actorUserId,
    } as const;
    const firstId = await repository.createDraft(draftInput);
    const secondId = await repository.createDraft(draftInput);
    const [first, balanceBefore] = await Promise.all([
      prisma.reprocessDocument.findUniqueOrThrow({
        where: { id: firstId },
        include: { linkedProductionBatch: true, sourceContributions: true },
      }),
      statusBalance("REPROCESS", state.productionLotId, grams.id),
    ]);
    expect(first.status).toBe("DRAFT");
    expect(first.linkedProductionBatch.batchType).toBe("REPROCESS");
    expect(first.linkedProductionBatch.status).toBe("DRAFT");
    expect(first.sourceContributions).toHaveLength(1);
    expect(first.sourceExpirySnapshot).toEqual(lot.expiryDate);
    expect(first.shelfLifeDaysSnapshot).toBe(60);
    expect(balanceBefore).toBe("50");

    await repository.updateDraftMetadata({
      id: firstId,
      reason: "Updated controlled draft reason.",
      notes: "Metadata-only edit preserves source genealogy.",
      actorUserId: state.actorUserId,
    });
    expect(
      await prisma.reprocessDocument.findUniqueOrThrow({ where: { id: firstId } }),
    ).toMatchObject({
      reason: "Updated controlled draft reason.",
      notes: "Metadata-only edit preserves source genealogy.",
      linkedProductionBatchId: first.linkedProductionBatchId,
    });
    expect(
      await prisma.auditEvent.count({
        where: { entityType: "REPROCESS_DOCUMENT", entityId: firstId, action: "UPDATE" },
      }),
    ).toBe(1);

    const draftMovements = await prisma.inventoryMovement.count({
      where: { referenceType: "REPROCESS_DOCUMENT", referenceId: { in: [firstId, secondId] } },
    });
    expect(draftMovements).toBe(0);
    expect(
      await prisma.productionBatch.findUniqueOrThrow({ where: { id: state.batchId } }),
    ).toMatchObject({ batchType: "NORMAL" });

    const concurrent = await Promise.allSettled([
      repository.reserve(firstId, state.actorUserId),
      repository.reserve(secondId, state.actorUserId),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    const reservedId = concurrent[0]!.status === "fulfilled" ? firstId : secondId;
    const rejectedId = reservedId === firstId ? secondId : firstId;
    const reserved = await prisma.reprocessDocument.findUniqueOrThrow({
      where: { id: reservedId },
      include: { sourceContributions: true },
    });
    expect(await statusBalance("REPROCESS", state.productionLotId, grams.id)).toBe("20");
    expect(await statusBalance("RESERVED", state.productionLotId, grams.id)).toBe("30");
    await expect(
      repository.updateDraftMetadata({
        id: reservedId,
        reason: "Must not update after reservation.",
        actorUserId: state.actorUserId,
      }),
    ).rejects.toThrow("Only a DRAFT Reprocess document can be edited");

    await expect(repository.reserve(reservedId, state.actorUserId)).rejects.toThrow(
      "Only a DRAFT reprocess can be reserved",
    );
    expect(await statusBalance("RESERVED", state.productionLotId, grams.id)).toBe("30");

    const rejected = await prisma.reprocessDocument.findUniqueOrThrow({
      where: { id: rejectedId },
    });
    await expect(
      prisma.reprocessDocument.update({
        where: { id: rejectedId },
        data: { linkedProductionBatchId: reserved.linkedProductionBatchId },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(
      await prisma.reprocessDocument.findUniqueOrThrow({ where: { id: rejectedId } }),
    ).toMatchObject({ linkedProductionBatchId: rejected.linkedProductionBatchId });

    await repository.cancel(reservedId, state.actorUserId, "Reservation is no longer required.");
    await expect(
      repository.cancel(reservedId, state.actorUserId, "Duplicate cancellation must fail."),
    ).rejects.toThrow("Only a DRAFT or RESERVED reprocess can be cancelled");
    expect(await statusBalance("REPROCESS", state.productionLotId, grams.id)).toBe("50");
    expect(await statusBalance("RESERVED", state.productionLotId, grams.id)).toBe("0");
    expect(
      await prisma.inventoryMovement.count({
        where: {
          reprocessSourceContributionId: reserved.sourceContributions[0]!.id,
          movementType: { in: ["REPROCESS_RESERVE", "REPROCESS_RESERVATION_RELEASE"] },
        },
      }),
    ).toBe(4);

    await repository.reserve(rejectedId, state.actorUserId);
    expect(await statusBalance("REPROCESS", state.productionLotId, grams.id)).toBe("20");
    await repository.cancel(rejectedId, state.actorUserId, "Integration fixture cleanup.");
    await restoreFixtureStatus(state, grams.id, "50", groupId, "REPROCESS", "AVAILABLE");
  });

  it("starts a valued piece source into WIP exactly once", async () => {
    const state = await executePhase27GoldenWorkflow();
    const pieces = await prisma.unit.findUniqueOrThrow({ where: { code: "PCS" } });
    const repository = new PrismaReprocessRepository();
    await placeInReprocess(state, pieces.id, "1");
    const id = await repository.createDraft({
      sourceProductionLotId: state.productionLotId,
      sourceWarehouseId: state.sourceWarehouseId,
      sourceQuantity: "1",
      sourceUnitId: pieces.id,
      recipeId: state.recipeId,
      plannedBatchQuantity: "1000",
      plannedBatchUnitId: (await prisma.unit.findUniqueOrThrow({ where: { code: "G" } })).id,
      plannedProductionDate: "2026-09-13",
      rawMaterialWarehouseId: state.sourceWarehouseId,
      packagingWarehouseId: state.sourceWarehouseId,
      finishedGoodsDestinationWarehouseId: state.sourceWarehouseId,
      plannedCartons: "0",
      plannedLoosePieces: "2",
      reason: "Controlled source-FG to WIP integration test.",
      actorUserId: state.actorUserId,
    });
    await repository.reserve(id, state.actorUserId);

    await repository.start(id, state.actorUserId);
    const document = await prisma.reprocessDocument.findUniqueOrThrow({
      where: { id },
      include: { linkedProductionBatch: true, sourceContributions: true, qcDecision: true },
    });
    expect(document.status).toBe("IN_PROGRESS");
    expect(document.linkedProductionBatch.status).toBe("IN_PROGRESS");
    expect(document.sourceContributions[0]!.startedAt).not.toBeNull();
    expect(document.qcDecision).toBeNull();
    expect(
      await prisma.productionLot.count({
        where: { productionBatchId: document.linkedProductionBatchId },
      }),
    ).toBe(0);
    const contribution = document.sourceContributions[0]!;
    const movement = await prisma.inventoryMovement.findFirstOrThrow({
      where: {
        reprocessSourceContributionId: contribution.id,
        movementType: "REPROCESS_CONSUMPTION",
      },
    });
    expect(movement.quantity.toString()).toBe("-1");
    expect(movement.productionLotId).toBe(state.productionLotId);
    expect(movement.productionBatchId).toBe(document.linkedProductionBatchId);
    const valuation = await prisma.inventoryValuationEntry.findUniqueOrThrow({
      where: { inventoryMovementId: movement.id },
    });
    expect(valuation).toMatchObject({
      state: "FINAL",
      entryType: "REPROCESS_CONSUMPTION",
      productionBatchId: document.linkedProductionBatchId,
      productionLotId: state.productionLotId,
    });
    expect(valuation.quantityEffect.toString()).toBe("-1");
    expect(new Decimal(valuation.valueDelta!.toString()).lt(0)).toBe(true);
    const journal = await prisma.accountingJournal.findUniqueOrThrow({
      where: {
        sourceType_sourceId: {
          sourceType: "REPROCESS_CONSUMPTION",
          sourceId: valuation.id,
        },
      },
      include: { lines: { include: { account: true } } },
    });
    expect(journal.totalDebit.toString()).toBe(journal.totalCredit.toString());
    const mappings = await prisma.accountingAccountMapping.findMany({
      where: { mappingKey: { in: ["FINISHED_GOODS_INVENTORY", "WORK_IN_PROCESS"] } },
      select: { accountId: true },
    });
    expect(journal.lines.map((line) => line.accountId).sort()).toEqual(
      mappings.map((mapping) => mapping.accountId).sort(),
    );
    const beforeDuplicate = await prisma.inventoryMovement.count({
      where: { reprocessSourceContributionId: contribution.id },
    });
    await expect(repository.start(id, state.actorUserId)).rejects.toThrow(
      "Only a RESERVED reprocess with an untouched linked batch can be started",
    );
    expect(
      await prisma.inventoryMovement.count({
        where: { reprocessSourceContributionId: contribution.id },
      }),
    ).toBe(beforeDuplicate);
  });

  it("rolls the physical start back when authoritative valuation basis is missing", async () => {
    const state = await executePhase27GoldenWorkflow();
    const pieces = await prisma.unit.findUniqueOrThrow({ where: { code: "PCS" } });
    const grams = await prisma.unit.findUniqueOrThrow({ where: { code: "G" } });
    const fixtureGroupId = await placeInReprocess(state, pieces.id, "1");
    const repository = new PrismaReprocessRepository();
    const id = await repository.createDraft({
      sourceProductionLotId: state.productionLotId,
      sourceWarehouseId: state.sourceWarehouseId,
      sourceQuantity: "1",
      sourceUnitId: pieces.id,
      recipeId: state.recipeId,
      plannedBatchQuantity: "1000",
      plannedBatchUnitId: grams.id,
      plannedProductionDate: "2026-09-13",
      rawMaterialWarehouseId: state.sourceWarehouseId,
      packagingWarehouseId: state.sourceWarehouseId,
      finishedGoodsDestinationWarehouseId: state.sourceWarehouseId,
      plannedCartons: "0",
      plannedLoosePieces: "2",
      reason: "Missing source value must block this start.",
      actorUserId: state.actorUserId,
    });
    await repository.reserve(id, state.actorUserId);
    const contribution = await prisma.reprocessSourceContribution.findFirstOrThrow({
      where: { reprocessDocumentId: id },
    });
    await prisma.inventoryValuationBalance.update({
      where: { itemId: state.finishedItemId },
      data: { missingBasisCount: 1, averageUnitCost: null },
    });
    const movementsBefore = await prisma.inventoryMovement.count({
      where: { reprocessSourceContributionId: contribution.id },
    });

    await expect(repository.start(id, state.actorUserId)).rejects.toThrow(
      "Inventory cannot leave the valuation pool",
    );
    expect(
      await prisma.inventoryMovement.count({
        where: { reprocessSourceContributionId: contribution.id },
      }),
    ).toBe(movementsBefore);
    expect(
      await prisma.inventoryValuationEntry.count({
        where: { sourceKey: `REPROCESS-CONSUMPTION-COST:${contribution.id}` },
      }),
    ).toBe(0);
    expect(await prisma.reprocessDocument.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "RESERVED",
    });
    expect(contribution.startedAt).toBeNull();

    const lastFinal = await prisma.inventoryValuationEntry.findFirstOrThrow({
      where: { itemId: state.finishedItemId, state: "FINAL" },
      orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
    });
    await prisma.inventoryValuationBalance.update({
      where: { itemId: state.finishedItemId },
      data: {
        missingBasisCount: 0,
        averageUnitCost: lastFinal.resultingAverageUnitCost,
      },
    });
    await repository.cancel(id, state.actorUserId, "Failed-start fixture cleanup.");
    await restoreFixtureStatus(state, pieces.id, "1", fixtureGroupId, "REPROCESS", "AVAILABLE");
  });

  it("executes additional inputs through the existing linked-batch engines", async () => {
    const state = await executePhase27GoldenWorkflow();
    const document = await prisma.reprocessDocument.findFirstOrThrow({
      where: {
        status: "IN_PROGRESS",
        sourceContributions: { some: { enteredUnit: { code: "PCS" } } },
      },
    });
    const batches = new PrismaProductionBatchRepository();
    const batch = await batches.getBatch(document.linkedProductionBatchId);
    expect(batch).toMatchObject({
      batchType: "REPROCESS",
      reprocessDocumentId: document.id,
      status: "IN_PROGRESS",
    });
    const materialRequirement = batch!.materialRequirements[0]!;
    const packagingRequirement = batch!.packagingRequirements[0]!;
    const packagingLot = await prisma.inventoryMovement.findFirstOrThrow({
      where: {
        itemId: state.packagingItemId,
        inventoryLotId: { not: null },
        quantity: { gt: 0 },
      },
      select: { inventoryLotId: true },
    });
    const materials = new PrismaProductionMaterialRepository();
    const materialIssue = await materials.createTransaction({
      productionBatchId: batch!.id,
      transactionType: "ISSUE",
      transactionDate: "2026-09-13",
      batchRequirementId: materialRequirement.id,
      inventoryLotId: state.rawInventoryLotId,
      quantity: "10",
      unitId: materialRequirement.canonicalUnitId,
      destinationWarehouseId: state.sourceWarehouseId,
      actorUserId: state.actorUserId,
    });
    await materials.postTransaction(materialIssue, state.actorUserId);
    const materialConsumption = await materials.createTransaction({
      productionBatchId: batch!.id,
      transactionType: "CONSUMPTION",
      transactionDate: "2026-09-13",
      batchRequirementId: materialRequirement.id,
      inventoryLotId: state.rawInventoryLotId,
      quantity: "10",
      unitId: materialRequirement.canonicalUnitId,
      actorUserId: state.actorUserId,
    });
    await materials.postTransaction(materialConsumption, state.actorUserId);

    const packaging = new PrismaProductionPackagingRepository();
    const packagingIssue = await packaging.createTransaction({
      productionBatchId: batch!.id,
      transactionType: "ISSUE",
      transactionDate: "2026-09-13",
      packagingRequirementId: packagingRequirement.id,
      inventoryLotId: packagingLot.inventoryLotId!,
      quantity: "1",
      unitId: packagingRequirement.canonicalUnitId,
      destinationWarehouseId: state.sourceWarehouseId,
      actorUserId: state.actorUserId,
    });
    await packaging.postTransaction(packagingIssue, state.actorUserId);
    const packagingConsumption = await packaging.createTransaction({
      productionBatchId: batch!.id,
      transactionType: "CONSUMPTION",
      transactionDate: "2026-09-13",
      packagingRequirementId: packagingRequirement.id,
      inventoryLotId: packagingLot.inventoryLotId!,
      quantity: "1",
      unitId: packagingRequirement.canonicalUnitId,
      actorUserId: state.actorUserId,
    });
    await packaging.postTransaction(packagingConsumption, state.actorUserId);

    expect(
      await prisma.productionMaterialTransaction.count({
        where: {
          productionBatchId: batch!.id,
          status: "POSTED",
          transactionType: { in: ["ISSUE", "CONSUMPTION"] },
        },
      }),
    ).toBe(4);
    expect(
      await prisma.inventoryValuationEntry.count({
        where: {
          productionBatchId: batch!.id,
          entryType: { in: ["PRODUCTION_CONSUMPTION", "PACKAGING_CONSUMPTION"] },
        },
      }),
    ).toBe(2);
  });

  it("creates a distinct QUALITY_HOLD child lot and freezes exact completion yield and expiry", async () => {
    const state = await executePhase27GoldenWorkflow();
    const document = await prisma.reprocessDocument.findFirstOrThrow({
      where: {
        status: "IN_PROGRESS",
        sourceContributions: { some: { enteredUnit: { code: "PCS" } } },
      },
      include: { sourceContributions: true },
    });
    const sourceLotBefore = await prisma.productionLot.findUniqueOrThrow({
      where: { id: document.sourceContributions[0]!.sourceProductionLotId },
    });
    const outputs = new PrismaProductionOutputRepository();
    await expect(
      outputs.completeBatch(document.linkedProductionBatchId, state.actorUserId),
    ).rejects.toThrow("Post at least one GOOD output");
    await expect(
      outputs.createTransaction({
        productionBatchId: document.linkedProductionBatchId,
        outputType: "GOOD",
        transactionDate: "2026-09-13T08:00:00.000Z",
        cartons: "0",
        loosePieces: "1",
        productionDate: "2026-09-13",
        expiryDate: "2027-09-13",
        destinationWarehouseId: state.sourceWarehouseId,
        actorUserId: state.actorUserId,
      }),
    ).rejects.toThrow("system-calculated and cannot be overridden");
    const outputId = await outputs.createTransaction({
      productionBatchId: document.linkedProductionBatchId,
      outputType: "GOOD",
      transactionDate: "2026-09-13T08:00:00.000Z",
      cartons: "0",
      loosePieces: "1",
      productionDate: "2026-09-13",
      destinationWarehouseId: state.sourceWarehouseId,
      actorUserId: state.actorUserId,
    });
    await outputs.postTransaction(outputId, state.actorUserId);
    const posted = await prisma.reprocessDocument.findUniqueOrThrow({
      where: { id: document.id },
      include: { childProductionLot: true },
    });
    expect(posted.childProductionLotId).not.toBe(sourceLotBefore.id);
    expect(posted.childProductionLot).toMatchObject({
      productionDate: new Date("2026-09-13T00:00:00.000Z"),
      expiryDate: new Date("2026-11-12T00:00:00.000Z"),
    });
    expect(posted.childExpiry).toEqual(new Date("2026-11-12T00:00:00.000Z"));
    expect(posted.policyExpiry).toEqual(new Date("2026-11-12T00:00:00.000Z"));
    expect(
      await statusBalance("QUALITY_HOLD", posted.childProductionLotId!, state.finishedItemId),
    ).toBe("1");
    expect(
      await statusBalance("AVAILABLE", posted.childProductionLotId!, state.finishedItemId),
    ).toBe("0");

    await outputs.completeBatch(document.linkedProductionBatchId, state.actorUserId);
    const completed = await prisma.reprocessDocument.findUniqueOrThrow({
      where: { id: document.id },
    });
    expect(completed).toMatchObject({
      status: "AWAITING_QC",
      completedByUserId: state.actorUserId,
      completionDate: new Date("2026-09-13T00:00:00.000Z"),
    });
    expect(completed.sourceContentConsumed?.toString()).toBe("500");
    expect(completed.goodContentOutput?.toString()).toBe("500");
    expect(completed.scrapContentOutput?.toString()).toBe("0");
    expect(completed.processLossContent?.toString()).toBe("0");
    expect(
      await prisma.productionLot.findUniqueOrThrow({ where: { id: sourceLotBefore.id } }),
    ).toMatchObject({
      productionDate: sourceLotBefore.productionDate,
      expiryDate: sourceLotBefore.expiryDate,
    });
    await expect(
      prisma.reprocessDocument.update({
        where: { id: completed.id },
        data: { childExpiry: new Date("2027-01-01T00:00:00.000Z") },
      }),
    ).rejects.toThrow("Completed Reprocess genealogy, dates, and yield are immutable");
    await expect(
      prisma.reprocessSourceContribution.update({
        where: { id: document.sourceContributions[0]!.id },
        data: { enteredQuantity: "2" },
      }),
    ).rejects.toThrow("Reprocess source genealogy is immutable");
  });

  it("capitalizes source and added-input WIP into the child exactly once", async () => {
    const state = await executePhase27GoldenWorkflow();
    const document = await prisma.reprocessDocument.findFirstOrThrow({
      where: { status: "AWAITING_QC" },
    });
    const costing = new PrismaInventoryValuationRepository();
    const before = await costing.getBatchCosting(document.linkedProductionBatchId);
    expect(before?.reprocessSourceCost).not.toBe("0.000000");
    expect(before?.rawMaterialCost).not.toBe("0.000000");
    expect(before?.packagingCost).not.toBe("0.000000");
    const expectedPool = new Decimal(before!.reprocessSourceCost)
      .add(before!.rawMaterialCost!)
      .add(before!.packagingCost!)
      .add(before!.additionalCost)
      .sub(before!.costCredits)
      .toFixed(6);
    expect(before?.finishedGoodsCostPool).toBe(expectedPool);

    await costing.finalizeBatchCost(document.linkedProductionBatchId, state.actorUserId);
    await expect(
      costing.finalizeBatchCost(document.linkedProductionBatchId, state.actorUserId),
    ).rejects.toThrow("already finalized");
    const snapshot = await prisma.productionBatchCostSnapshot.findUniqueOrThrow({
      where: { productionBatchId: document.linkedProductionBatchId },
    });
    expect(
      new Decimal(snapshot.reprocessSourceCost.toString()).eq(before!.reprocessSourceCost),
    ).toBe(true);
    expect(new Decimal(snapshot.finishedGoodsCostPool.toString()).eq(expectedPool)).toBe(true);
    const outputValuation = await prisma.inventoryValuationEntry.findFirstOrThrow({
      where: {
        productionBatchId: document.linkedProductionBatchId,
        productionLotId: document.childProductionLotId!,
        entryType: "REPROCESS_OUTPUT",
      },
    });
    expect(new Decimal(outputValuation.valueDelta!.toString()).eq(expectedPool)).toBe(true);
    expect(outputValuation.quantityEffect.toString()).toBe("1");
    const journal = await prisma.accountingJournal.findUniqueOrThrow({
      where: {
        sourceType_sourceId: { sourceType: "PRODUCTION_OUTPUT", sourceId: snapshot.id },
      },
    });
    expect(new Decimal(journal.totalDebit.toString()).eq(expectedPool)).toBe(true);
    expect(new Decimal(journal.totalCredit.toString()).eq(expectedPool)).toBe(true);
    expect(
      await prisma.accountingJournal.count({
        where: { sourceType: "PRODUCTION_OUTPUT", sourceId: snapshot.id },
      }),
    ).toBe(1);
  });

  it("requires an independent quality actor and releases an approved child exactly once", async () => {
    const state = await executePhase27GoldenWorkflow();
    const document = await prisma.reprocessDocument.findFirstOrThrow({
      where: { status: "AWAITING_QC" },
    });
    const repository = new PrismaReprocessRepository();
    const qualityActorId = await ensureQualityActor();
    const movementCount = await prisma.inventoryMovement.count({
      where: { referenceType: "REPROCESS_QC", referenceId: document.id },
    });

    await expect(
      repository.decideQuality({
        id: document.id,
        decision: "APPROVED",
        actorUserId: state.actorUserId,
      }),
    ).rejects.toThrow("Another authorized quality user");
    expect(
      await prisma.inventoryMovement.count({
        where: { referenceType: "REPROCESS_QC", referenceId: document.id },
      }),
    ).toBe(movementCount);

    await repository.decideQuality({
      id: document.id,
      decision: "APPROVED",
      notes: "Independent release review passed.",
      actorUserId: qualityActorId,
    });
    expect(
      await statusBalance("QUALITY_HOLD", document.childProductionLotId!, state.finishedItemId),
    ).toBe("0");
    expect(
      await statusBalance("AVAILABLE", document.childProductionLotId!, state.finishedItemId),
    ).toBe("1");
    const released = await prisma.reprocessDocument.findUniqueOrThrow({
      where: { id: document.id },
      include: { qcDecision: true },
    });
    expect(released).toMatchObject({ status: "RELEASED" });
    expect(released.qcDecision).toMatchObject({
      decision: "APPROVED",
      inspectedByUserId: qualityActorId,
    });
    expect(
      await prisma.auditEvent.findFirstOrThrow({
        where: {
          entityType: "REPROCESS_DOCUMENT",
          entityId: document.id,
          actorUserId: qualityActorId,
          module: "quality",
        },
      }),
    ).toMatchObject({ action: "APPROVE" });
    await expect(
      repository.decideQuality({
        id: document.id,
        decision: "APPROVED",
        actorUserId: qualityActorId,
      }),
    ).rejects.toThrow("Only an undecided AWAITING_QC");
    await expect(
      prisma.reprocessQcDecision.update({
        where: { reprocessDocumentId: document.id },
        data: { notes: "tamper" },
      }),
    ).rejects.toThrow(/reprocess QC decisions are immutable/i);
    await expect(
      prisma.reprocessQcDecision.delete({ where: { reprocessDocumentId: document.id } }),
    ).rejects.toThrow(/reprocess QC decisions are immutable/i);
  });

  it("quarantines a rejected child and preserves the earlier source expiry", async () => {
    const state = await executePhase27GoldenWorkflow();
    const pieces = await prisma.unit.findUniqueOrThrow({ where: { code: "PCS" } });
    const grams = await prisma.unit.findUniqueOrThrow({ where: { code: "G" } });
    const released = await prisma.reprocessDocument.findFirstOrThrow({
      where: { status: "RELEASED" },
      include: { childProductionLot: true },
    });
    await placeInReprocess(state, pieces.id, "1", released.childProductionLotId!);
    const repository = new PrismaReprocessRepository();
    const id = await repository.createDraft({
      sourceProductionLotId: released.childProductionLotId!,
      sourceWarehouseId: state.sourceWarehouseId,
      sourceQuantity: "1",
      sourceUnitId: pieces.id,
      recipeId: state.recipeId,
      plannedBatchQuantity: "1000",
      plannedBatchUnitId: grams.id,
      plannedProductionDate: "2026-09-14",
      rawMaterialWarehouseId: state.sourceWarehouseId,
      packagingWarehouseId: state.sourceWarehouseId,
      finishedGoodsDestinationWarehouseId: state.sourceWarehouseId,
      plannedCartons: "0",
      plannedLoosePieces: "1",
      reason: "Second controlled cycle exercises quality rejection.",
      actorUserId: state.actorUserId,
    });
    await repository.reserve(id, state.actorUserId);
    await repository.start(id, state.actorUserId);
    const document = await prisma.reprocessDocument.findUniqueOrThrow({ where: { id } });
    const outputs = new PrismaProductionOutputRepository();
    const outputId = await outputs.createTransaction({
      productionBatchId: document.linkedProductionBatchId,
      outputType: "GOOD",
      transactionDate: "2026-09-14T08:00:00.000Z",
      cartons: "0",
      loosePieces: "1",
      productionDate: "2026-09-14",
      destinationWarehouseId: state.sourceWarehouseId,
      actorUserId: state.actorUserId,
    });
    await outputs.postTransaction(outputId, state.actorUserId);
    await outputs.completeBatch(document.linkedProductionBatchId, state.actorUserId);
    await new PrismaInventoryValuationRepository().finalizeBatchCost(
      document.linkedProductionBatchId,
      state.actorUserId,
    );
    const awaiting = await prisma.reprocessDocument.findUniqueOrThrow({ where: { id } });
    expect(awaiting.childExpiry).toEqual(released.childProductionLot!.expiryDate);

    await repository.decideQuality({
      id,
      decision: "REJECTED",
      rejectionReason: "QUALITY_REJECT",
      notes: "Independent inspection rejected the output.",
      actorUserId: await ensureQualityActor(),
    });
    expect(
      await statusBalance("QUALITY_HOLD", awaiting.childProductionLotId!, state.finishedItemId),
    ).toBe("0");
    expect(
      await statusBalance("AVAILABLE", awaiting.childProductionLotId!, state.finishedItemId),
    ).toBe("0");
    expect(
      await statusBalance("QUARANTINE", awaiting.childProductionLotId!, state.finishedItemId),
    ).toBe("1");
    expect(
      await prisma.reprocessDocument.findUniqueOrThrow({
        where: { id },
        include: { qcDecision: true },
      }),
    ).toMatchObject({
      status: "REJECTED",
      qcDecision: { decision: "REJECTED", rejectionReason: "QUALITY_REJECT" },
    });
  });

  it("cancels a Waste draft without inventory, valuation, or accounting effects", async () => {
    const state = await executePhase27GoldenWorkflow();
    const pieces = await prisma.unit.findUniqueOrThrow({ where: { code: "PCS" } });
    await moveStatusFixture(state, state.productionLotId, pieces.id, "1", "AVAILABLE", "DAMAGED");
    const repository = new PrismaWasteDispositionRepository();
    const input = {
      dispositionDate: "2026-09-14",
      warehouseId: state.sourceWarehouseId,
      notes: "Initial draft.",
      lines: [
        {
          itemId: state.finishedItemId,
          productionLotId: state.productionLotId,
          sourceStatus: "DAMAGED",
          quantity: "1",
          unitId: pieces.id,
          action: "MOVE_TO_REPROCESS",
          reason: "DAMAGED",
        },
      ],
      actorUserId: state.actorUserId,
    } as const;
    await expect(
      repository.saveDraft({ ...input, actorUserId: await ensureProductionOnlyActor() }),
    ).rejects.toThrow("Inventory management permission is required");
    const id = await repository.saveDraft(input);
    expect(await repository.saveDraft({ ...input, id, notes: "Edited before cancellation." })).toBe(
      id,
    );
    expect(
      await prisma.wasteDisposition.findUniqueOrThrow({
        where: { id },
        include: { lines: true },
      }),
    ).toMatchObject({ notes: "Edited before cancellation.", lines: [{ reason: "DAMAGED" }] });
    expect(await dispositionEffects(id)).toEqual({ movements: 0, valuations: 0, journals: 0 });
    await repository.cancel(id, state.actorUserId, "Draft entered only to prove no side effects.");
    expect(await prisma.wasteDisposition.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "CANCELLED",
      cancelledByUserId: state.actorUserId,
    });
    expect(await dispositionEffects(id)).toEqual({ movements: 0, valuations: 0, journals: 0 });
    await expect(repository.post(id, state.actorUserId)).rejects.toThrow("Only a DRAFT");
  });

  it("moves eligible damaged FG to REPROCESS without premature loss and preserves genealogy", async () => {
    const state = await executePhase27GoldenWorkflow();
    const pieces = await prisma.unit.findUniqueOrThrow({ where: { code: "PCS" } });
    const grams = await prisma.unit.findUniqueOrThrow({ where: { code: "G" } });
    const repository = new PrismaWasteDispositionRepository();
    await prisma.finishedGoodProfile.update({
      where: { itemId: state.finishedItemId },
      data: { reprocessShelfLifeDays: null },
    });
    await expect(
      repository.saveDraft({
        dispositionDate: "2026-09-14",
        warehouseId: state.sourceWarehouseId,
        lines: [
          {
            itemId: state.finishedItemId,
            productionLotId: state.productionLotId,
            sourceStatus: "DAMAGED",
            quantity: "1",
            unitId: pieces.id,
            action: "MOVE_TO_REPROCESS",
            reason: "DAMAGED",
          },
        ],
        actorUserId: state.actorUserId,
      }),
    ).rejects.toThrow("Configure");
    await prisma.finishedGoodProfile.update({
      where: { itemId: state.finishedItemId },
      data: { reprocessShelfLifeDays: 60 },
    });
    const id = await repository.saveDraft({
      dispositionDate: "2026-09-14",
      warehouseId: state.sourceWarehouseId,
      lines: [
        {
          itemId: state.finishedItemId,
          productionLotId: state.productionLotId,
          sourceStatus: "DAMAGED",
          quantity: "1",
          unitId: pieces.id,
          action: "MOVE_TO_REPROCESS",
          reason: "PACKAGING_DAMAGE",
        },
      ],
      actorUserId: state.actorUserId,
    });
    const workflowCountsBefore = await Promise.all([
      prisma.reprocessDocument.count(),
      prisma.productionBatch.count(),
      prisma.productionLot.count(),
    ]);
    await repository.post(id, state.actorUserId);
    expect(await statusBalance("DAMAGED", state.productionLotId, pieces.id)).toBe("0");
    expect(await statusBalance("REPROCESS", state.productionLotId, pieces.id)).toBe("1");
    expect(await dispositionEffects(id)).toEqual({ movements: 2, valuations: 0, journals: 0 });
    expect(
      await Promise.all([
        prisma.reprocessDocument.count(),
        prisma.productionBatch.count(),
        prisma.productionLot.count(),
      ]),
    ).toEqual(workflowCountsBefore);
    await expect(repository.post(id, state.actorUserId)).rejects.toThrow("Only a DRAFT");

    const line = await prisma.wasteDispositionLine.findFirstOrThrow({
      where: { wasteDispositionId: id },
    });
    const reprocessId = await new PrismaReprocessRepository().createDraft({
      sourceProductionLotId: state.productionLotId,
      sourceWarehouseId: state.sourceWarehouseId,
      sourceQuantity: "1",
      sourceUnitId: pieces.id,
      recipeId: state.recipeId,
      plannedBatchQuantity: "1000",
      plannedBatchUnitId: grams.id,
      plannedProductionDate: "2026-09-14",
      rawMaterialWarehouseId: state.sourceWarehouseId,
      packagingWarehouseId: state.sourceWarehouseId,
      finishedGoodsDestinationWarehouseId: state.sourceWarehouseId,
      plannedCartons: "0",
      plannedLoosePieces: "1",
      reason: "Genealogy link from controlled disposition.",
      actorUserId: state.actorUserId,
    });
    expect(
      await prisma.reprocessSourceContribution.findFirstOrThrow({
        where: { reprocessDocumentId: reprocessId },
      }),
    ).toMatchObject({ sourceWasteDispositionLineId: line.id });
    await new PrismaReprocessRepository().reserve(reprocessId, state.actorUserId);
    expect(await statusBalance("REPROCESS", state.productionLotId, pieces.id)).toBe("0");
    expect(
      await prisma.inventoryMovement.count({ where: { wasteDispositionLineId: line.id } }),
    ).toBe(2);
    expect(
      await prisma.auditEvent.count({
        where: { entityType: "WASTE_DISPOSITION", entityId: id, action: "POST" },
      }),
    ).toBe(1);
  });

  it("moves quarantined FG to SCRAP without derecognition, then writes it off once at authoritative value", async () => {
    const state = await executePhase27GoldenWorkflow();
    const pieces = await prisma.unit.findUniqueOrThrow({ where: { code: "PCS" } });
    const rejected = await prisma.reprocessDocument.findFirstOrThrow({
      where: { status: "REJECTED" },
    });
    const repository = new PrismaWasteDispositionRepository();
    const ownedBeforeScrap = await prisma.inventoryValuationBalance.findUniqueOrThrow({
      where: { itemId: state.finishedItemId },
    });
    const scrapId = await repository.saveDraft({
      dispositionDate: "2026-09-14",
      warehouseId: state.sourceWarehouseId,
      lines: [
        {
          itemId: state.finishedItemId,
          productionLotId: rejected.childProductionLotId!,
          sourceStatus: "QUARANTINE",
          quantity: "1",
          unitId: pieces.id,
          action: "MOVE_TO_SCRAP",
          reason: "QUALITY_REJECT",
        },
      ],
      actorUserId: state.actorUserId,
    });
    await repository.post(scrapId, state.actorUserId);
    expect(await statusBalance("QUARANTINE", rejected.childProductionLotId!, pieces.id)).toBe("0");
    expect(await statusBalance("SCRAP", rejected.childProductionLotId!, pieces.id)).toBe("1");
    expect(await dispositionEffects(scrapId)).toEqual({ movements: 2, valuations: 0, journals: 0 });
    expect(
      (
        await prisma.inventoryValuationBalance.findUniqueOrThrow({
          where: { itemId: state.finishedItemId },
        })
      ).ownedQuantity,
    ).toEqual(ownedBeforeScrap.ownedQuantity);

    const writeOffId = await repository.saveDraft({
      dispositionDate: "2026-09-14",
      warehouseId: state.sourceWarehouseId,
      lines: [
        {
          itemId: state.finishedItemId,
          productionLotId: rejected.childProductionLotId!,
          sourceStatus: "SCRAP",
          quantity: "1",
          unitId: pieces.id,
          action: "WRITE_OFF",
          reason: "QUALITY_REJECT",
        },
      ],
      actorUserId: state.actorUserId,
    });
    const beforeWriteOff = await prisma.inventoryValuationBalance.findUniqueOrThrow({
      where: { itemId: state.finishedItemId },
    });
    const expectedValue = new Decimal(beforeWriteOff.averageUnitCost!.toString()).toFixed(6);
    const lossMapping = await prisma.accountingAccountMapping.findUniqueOrThrow({
      where: {
        accountingSettingsId_mappingKey: {
          accountingSettingsId: "default",
          mappingKey: "INVENTORY_LOSS_EXPENSE",
        },
      },
    });
    await prisma.accountingAccount.update({
      where: { id: lossMapping.accountId },
      data: { active: false },
    });
    await expect(repository.post(writeOffId, state.actorUserId)).rejects.toThrow(
      "inventory-loss accounting",
    );
    expect(await dispositionEffects(writeOffId)).toEqual({
      movements: 0,
      valuations: 0,
      journals: 0,
    });
    expect(await statusBalance("SCRAP", rejected.childProductionLotId!, pieces.id)).toBe("1");
    expect(
      await prisma.wasteDisposition.findUniqueOrThrow({ where: { id: writeOffId } }),
    ).toMatchObject({ status: "DRAFT" });
    await prisma.accountingAccount.update({
      where: { id: lossMapping.accountId },
      data: { active: true },
    });
    await repository.post(writeOffId, state.actorUserId);
    const line = await prisma.wasteDispositionLine.findFirstOrThrow({
      where: { wasteDispositionId: writeOffId },
    });
    const valuation = await prisma.inventoryValuationEntry.findUniqueOrThrow({
      where: { id: line.originalValuationEntryId! },
    });
    expect(valuation).toMatchObject({ entryType: "INVENTORY_WRITE_OFF", state: "FINAL" });
    expect(valuation.quantityEffect.toString()).toBe("-1");
    expect(valuation.valueDelta!.abs().toFixed(6)).toBe(expectedValue);
    expect(line.originalValue!.toFixed(6)).toBe(expectedValue);
    const journal = await prisma.accountingJournal.findUniqueOrThrow({
      where: { id: line.originalAccountingJournalId! },
      include: { lines: { include: { account: true } } },
    });
    expect(journal.totalDebit.toString()).toBe(journal.totalCredit.toString());
    const mapped = await prisma.accountingAccountMapping.findMany({
      where: {
        mappingKey: { in: ["INVENTORY_LOSS_EXPENSE", "FINISHED_GOODS_INVENTORY"] },
      },
      select: { accountId: true },
    });
    expect(journal.lines.map((entry) => entry.accountId).sort()).toEqual(
      mapped.map((entry) => entry.accountId).sort(),
    );
    expect(await statusBalance("SCRAP", rejected.childProductionLotId!, pieces.id)).toBe("0");
    const afterWriteOff = await prisma.inventoryValuationBalance.findUniqueOrThrow({
      where: { itemId: state.finishedItemId },
    });
    expect(
      new Decimal(afterWriteOff.ownedQuantity.toString()).eq(
        new Decimal(beforeWriteOff.ownedQuantity.toString()).sub(1),
      ),
    ).toBe(true);
    await expect(repository.post(writeOffId, state.actorUserId)).rejects.toThrow("Only a DRAFT");
    expect(await dispositionEffects(writeOffId)).toEqual({
      movements: 1,
      valuations: 1,
      journals: 1,
    });
    await expect(
      prisma.wasteDispositionLine.update({ where: { id: line.id }, data: { notes: "tamper" } }),
    ).rejects.toThrow(/immutable/i);
  });

  it("uses compensating reversals, restores original write-off value, and blocks downstream claims", async () => {
    const state = await executePhase27GoldenWorkflow();
    const pieces = await prisma.unit.findUniqueOrThrow({ where: { code: "PCS" } });
    const repository = new PrismaWasteDispositionRepository();
    const writeOff = await prisma.wasteDisposition.findFirstOrThrow({
      where: { status: "POSTED", lines: { some: { action: "WRITE_OFF" } } },
      include: { lines: true },
    });
    const originalLine = writeOff.lines[0]!;
    const [originalMovement, originalValuation, originalJournal, balanceBefore] = await Promise.all(
      [
        prisma.inventoryMovement.findFirstOrThrow({
          where: { wasteDispositionLineId: originalLine.id, movementType: "WASTE_WRITE_OFF" },
        }),
        prisma.inventoryValuationEntry.findUniqueOrThrow({
          where: { id: originalLine.originalValuationEntryId! },
        }),
        prisma.accountingJournal.findUniqueOrThrow({
          where: { id: originalLine.originalAccountingJournalId! },
        }),
        prisma.inventoryValuationBalance.findUniqueOrThrow({
          where: { itemId: state.finishedItemId },
        }),
      ],
    );
    const period = await prisma.accountingPeriod.findFirstOrThrow({
      where: {
        startDate: { lte: new Date() },
        endDate: { gte: new Date() },
      },
    });
    await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: "CLOSED" } });
    await expect(
      repository.reverse(writeOff.id, state.actorUserId, "Test closed-period reversal block."),
    ).rejects.toThrow("accounting period");
    expect(
      await prisma.wasteDisposition.findUniqueOrThrow({
        where: { id: writeOff.id },
        include: { reversal: true },
      }),
    ).toMatchObject({ status: "POSTED", reversal: null });
    expect(
      await prisma.inventoryMovement.count({
        where: { referenceType: "WASTE_DISPOSITION_REVERSAL", referenceId: writeOff.id },
      }),
    ).toBe(0);
    await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: "OPEN" } });

    const reversalId = await repository.reverse(
      writeOff.id,
      state.actorUserId,
      "Approved correction restores the exact original write-off.",
    );
    const reversal = await prisma.wasteDisposition.findUniqueOrThrow({
      where: { id: reversalId },
      include: { lines: true },
    });
    expect(reversal).toMatchObject({ status: "POSTED", reversalOfId: writeOff.id });
    expect(
      await prisma.wasteDisposition.findUniqueOrThrow({ where: { id: writeOff.id } }),
    ).toMatchObject({
      status: "REVERSED",
      reversedByUserId: state.actorUserId,
    });
    const reversalMovement = await prisma.inventoryMovement.findFirstOrThrow({
      where: { wasteDispositionLineId: reversal.lines[0]!.id, movementType: "WASTE_REVERSAL" },
    });
    expect(reversalMovement.quantity.toString()).toBe("1");
    expect(reversalMovement.status).toBe("SCRAP");
    const reversalValuation = await prisma.inventoryValuationEntry.findUniqueOrThrow({
      where: { inventoryMovementId: reversalMovement.id },
    });
    expect(reversalValuation.entryType).toBe("INVENTORY_WRITE_OFF_REVERSAL");
    expect(reversalValuation.valueDelta!.toFixed(6)).toBe(originalLine.originalValue!.toFixed(6));
    const reversalJournal = await prisma.accountingJournal.findUniqueOrThrow({
      where: {
        sourceType_sourceId: {
          sourceType: "INVENTORY_WRITE_OFF_REVERSAL",
          sourceId: reversalValuation.id,
        },
      },
    });
    expect(reversalJournal.totalDebit.toString()).toBe(reversalJournal.totalCredit.toString());
    const balanceAfter = await prisma.inventoryValuationBalance.findUniqueOrThrow({
      where: { itemId: state.finishedItemId },
    });
    expect(balanceAfter.ownedQuantity.toString()).toBe(
      balanceBefore.ownedQuantity.add(1).toString(),
    );
    expect(balanceAfter.inventoryValue.toFixed(6)).toBe(
      balanceBefore.inventoryValue.add(originalLine.originalValue!).toFixed(6),
    );
    expect(
      await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: originalMovement.id } }),
    ).toEqual(originalMovement);
    expect(
      await prisma.inventoryValuationEntry.findUniqueOrThrow({
        where: { id: originalValuation.id },
      }),
    ).toEqual(originalValuation);
    expect(
      await prisma.accountingJournal.findUniqueOrThrow({ where: { id: originalJournal.id } }),
    ).toEqual(originalJournal);
    await expect(
      repository.reverse(writeOff.id, state.actorUserId, "Duplicate reversal must fail."),
    ).rejects.toThrow("Only an unreversed POSTED");

    const priorScrap = await prisma.wasteDisposition.findFirstOrThrow({
      where: { status: "POSTED", lines: { some: { action: "MOVE_TO_SCRAP" } } },
    });
    await expect(
      repository.reverse(priorScrap.id, state.actorUserId, "Downstream write-off must block."),
    ).rejects.toThrow("later disposition activity");

    const childLotId = reversal.lines[0]!.productionLotId!;
    await moveStatusFixture(state, childLotId, pieces.id, "1", "SCRAP", "DAMAGED");
    const safeScrapId = await repository.saveDraft({
      dispositionDate: "2026-09-14",
      warehouseId: state.sourceWarehouseId,
      lines: [
        {
          itemId: state.finishedItemId,
          productionLotId: childLotId,
          sourceStatus: "DAMAGED",
          quantity: "1",
          unitId: pieces.id,
          action: "MOVE_TO_SCRAP",
          reason: "DAMAGED",
        },
      ],
      actorUserId: state.actorUserId,
    });
    await repository.post(safeScrapId, state.actorUserId);
    const safeScrapReversalId = await repository.reverse(
      safeScrapId,
      state.actorUserId,
      "No downstream use; return to damaged custody.",
    );
    expect(await statusBalance("DAMAGED", childLotId, pieces.id)).toBe("1");
    expect(
      await prisma.inventoryMovement.count({
        where: { referenceId: safeScrapReversalId, movementType: "WASTE_REVERSAL" },
      }),
    ).toBe(2);

    const safeReprocessId = await repository.saveDraft({
      dispositionDate: "2026-09-14",
      warehouseId: state.sourceWarehouseId,
      lines: [
        {
          itemId: state.finishedItemId,
          productionLotId: childLotId,
          sourceStatus: "DAMAGED",
          quantity: "1",
          unitId: pieces.id,
          action: "MOVE_TO_REPROCESS",
          reason: "DAMAGED",
        },
      ],
      actorUserId: state.actorUserId,
    });
    await repository.post(safeReprocessId, state.actorUserId);
    await repository.reverse(
      safeReprocessId,
      state.actorUserId,
      "No Reprocess claim exists; return to damaged custody.",
    );
    expect(await statusBalance("REPROCESS", childLotId, pieces.id)).toBe("0");
    expect(await statusBalance("DAMAGED", childLotId, pieces.id)).toBe("1");

    const claimedReprocess = await prisma.wasteDisposition.findFirstOrThrow({
      where: {
        status: "POSTED",
        lines: {
          some: { action: "MOVE_TO_REPROCESS", reprocessSourceContributions: { some: {} } },
        },
      },
    });
    await expect(
      repository.reverse(claimedReprocess.id, state.actorUserId, "Claimed custody must block."),
    ).rejects.toThrow("claimed by Reprocess");
  });
});

async function placeInReprocess(
  state: Awaited<ReturnType<typeof executePhase27GoldenWorkflow>>,
  canonicalUnitId: string,
  quantity: string,
  productionLotId = state.productionLotId,
) {
  const groupId = randomUUID();
  await prisma.inventoryMovement.createMany({
    data: [
      {
        itemId: state.finishedItemId,
        warehouseId: state.sourceWarehouseId,
        status: "AVAILABLE",
        quantity: new Decimal(quantity).negated().toFixed(),
        canonicalUnitId,
        movementType: "STATUS_OUT",
        referenceType: "TEST_WASTE_HANDOFF",
        referenceId: groupId,
        sourceKey: `${groupId}:OUT`,
        groupId,
        reason: "Integration fixture simulates the authoritative Waste handoff.",
        createdByUserId: state.actorUserId,
        productionLotId,
      },
      {
        itemId: state.finishedItemId,
        warehouseId: state.sourceWarehouseId,
        status: "REPROCESS",
        quantity,
        canonicalUnitId,
        movementType: "STATUS_IN",
        referenceType: "TEST_WASTE_HANDOFF",
        referenceId: groupId,
        sourceKey: `${groupId}:IN`,
        groupId,
        reason: "Integration fixture simulates the authoritative Waste handoff.",
        createdByUserId: state.actorUserId,
        productionLotId,
      },
    ],
  });
  return groupId;
}

async function restoreFixtureStatus(
  state: Awaited<ReturnType<typeof executePhase27GoldenWorkflow>>,
  canonicalUnitId: string,
  quantity: string,
  fixtureGroupId: string,
  sourceStatus: "REPROCESS",
  destinationStatus: "AVAILABLE",
) {
  const groupId = randomUUID();
  await prisma.inventoryMovement.createMany({
    data: [
      {
        itemId: state.finishedItemId,
        warehouseId: state.sourceWarehouseId,
        status: sourceStatus,
        quantity: new Decimal(quantity).negated().toFixed(),
        canonicalUnitId,
        movementType: "STATUS_OUT",
        referenceType: "TEST_REPROCESS_FIXTURE_REVERSAL",
        referenceId: fixtureGroupId,
        sourceKey: `${groupId}:OUT`,
        groupId,
        reason: "Integration fixture cleanup.",
        createdByUserId: state.actorUserId,
        productionLotId: state.productionLotId,
      },
      {
        itemId: state.finishedItemId,
        warehouseId: state.sourceWarehouseId,
        status: destinationStatus,
        quantity,
        canonicalUnitId,
        movementType: "STATUS_IN",
        referenceType: "TEST_REPROCESS_FIXTURE_REVERSAL",
        referenceId: fixtureGroupId,
        sourceKey: `${groupId}:IN`,
        groupId,
        reason: "Integration fixture cleanup.",
        createdByUserId: state.actorUserId,
        productionLotId: state.productionLotId,
      },
    ],
  });
}

async function statusBalance(
  status:
    "REPROCESS" | "RESERVED" | "QUALITY_HOLD" | "AVAILABLE" | "QUARANTINE" | "DAMAGED" | "SCRAP",
  productionLotId: string,
  itemOrUnitId: string,
) {
  const result = await prisma.inventoryMovement.aggregate({
    where:
      status === "QUALITY_HOLD" || status === "AVAILABLE" || status === "QUARANTINE"
        ? { status, productionLotId, itemId: itemOrUnitId }
        : { status, productionLotId, canonicalUnitId: itemOrUnitId },
    _sum: { quantity: true },
  });
  return new Decimal(result._sum.quantity?.toString() ?? "0").toFixed();
}

async function moveStatusFixture(
  state: Awaited<ReturnType<typeof executePhase27GoldenWorkflow>>,
  productionLotId: string,
  canonicalUnitId: string,
  quantity: string,
  sourceStatus: "AVAILABLE" | "QUARANTINE" | "SCRAP",
  destinationStatus: "DAMAGED" | "SCRAP",
) {
  const groupId = randomUUID();
  await prisma.inventoryMovement.createMany({
    data: [
      {
        itemId: state.finishedItemId,
        warehouseId: state.sourceWarehouseId,
        status: sourceStatus,
        quantity: new Decimal(quantity).negated().toFixed(),
        canonicalUnitId,
        movementType: "STATUS_OUT",
        referenceType: "TEST_WASTE_FIXTURE",
        referenceId: groupId,
        sourceKey: `${groupId}:OUT`,
        groupId,
        reason: "Integration fixture establishes controlled damaged custody.",
        createdByUserId: state.actorUserId,
        productionLotId,
      },
      {
        itemId: state.finishedItemId,
        warehouseId: state.sourceWarehouseId,
        status: destinationStatus,
        quantity,
        canonicalUnitId,
        movementType: "STATUS_IN",
        referenceType: "TEST_WASTE_FIXTURE",
        referenceId: groupId,
        sourceKey: `${groupId}:IN`,
        groupId,
        reason: "Integration fixture establishes controlled damaged custody.",
        createdByUserId: state.actorUserId,
        productionLotId,
      },
    ],
  });
}

async function dispositionEffects(id: string) {
  const lines = await prisma.wasteDispositionLine.findMany({
    where: { wasteDispositionId: id },
    select: { id: true, originalValuationEntryId: true },
  });
  const lineIds = lines.map((line) => line.id);
  const valuationIds = lines.flatMap((line) =>
    line.originalValuationEntryId ? [line.originalValuationEntryId] : [],
  );
  const [movements, valuations, journals] = await Promise.all([
    prisma.inventoryMovement.count({ where: { wasteDispositionLineId: { in: lineIds } } }),
    prisma.inventoryValuationEntry.count({
      where: { sourceType: "WASTE_DISPOSITION", sourceId: id },
    }),
    prisma.accountingJournal.count({
      where: { sourceType: "INVENTORY_WRITE_OFF", sourceId: { in: valuationIds } },
    }),
  ]);
  return { movements, valuations, journals };
}

async function ensureQualityActor() {
  const userId = "00000000-0000-4000-8000-000000000071";
  const [user, role, permission] = await Promise.all([
    prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        name: "Reprocess Quality Inspector",
        email: "reprocess.quality@example.test",
        emailVerified: true,
      },
      update: { active: true },
    }),
    prisma.role.upsert({
      where: { code: "TEST_REPROCESS_QUALITY" },
      create: { code: "TEST_REPROCESS_QUALITY", name: "Test Reprocess Quality", isSystem: false },
      update: {},
    }),
    prisma.permission.findUniqueOrThrow({ where: { code: "quality.manage" } }),
  ]);
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    create: { roleId: role.id, permissionId: permission.id },
    update: {},
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    create: { userId: user.id, roleId: role.id },
    update: {},
  });
  return user.id;
}

async function ensureProductionOnlyActor() {
  const userId = "00000000-0000-4000-8000-000000000072";
  const [user, role, permission] = await Promise.all([
    prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        name: "Production-only Waste Test Actor",
        email: "waste.production-only@example.test",
        emailVerified: true,
      },
      update: { active: true },
    }),
    prisma.role.upsert({
      where: { code: "TEST_PRODUCTION_ONLY" },
      create: { code: "TEST_PRODUCTION_ONLY", name: "Test Production Only", isSystem: false },
      update: {},
    }),
    prisma.permission.findUniqueOrThrow({ where: { code: "production.manage" } }),
  ]);
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    create: { roleId: role.id, permissionId: permission.id },
    update: {},
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    create: { userId: user.id, roleId: role.id },
    update: {},
  });
  return user.id;
}
