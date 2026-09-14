import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { e2eStatePath } from "../e2e/state";
import { prisma } from "../src/server/db/prisma";
import { PrismaInventoryValuationRepository } from "../src/server/costing/prisma-inventory-valuation-repository";
import { PrismaProductionMaterialRepository } from "../src/server/production/prisma-production-material-repository";
import { PrismaProductionOutputRepository } from "../src/server/production/prisma-production-output-repository";
import { PrismaProductionPackagingRepository } from "../src/server/production/prisma-production-packaging-repository";
import { PrismaProductionBatchRepository } from "../src/server/production/prisma-production-batch-repository";
import { PrismaReprocessRepository } from "../src/server/production/prisma-reprocess-repository";
import { executePhase27GoldenWorkflow } from "../src/test/phase27-golden-workflow";

const state = await executePhase27GoldenWorkflow();
const pieces = await prisma.unit.findUniqueOrThrow({ where: { code: "PCS" } });
await prisma.finishedGoodProfile.update({
  where: { itemId: state.finishedItemId },
  data: { reprocessShelfLifeDays: 60 },
});
for (const [status, suffix, quantity] of [
  ["REPROCESS", "REPROCESS", "3"],
  ["DAMAGED", "DAMAGED", "1"],
] as const) {
  const groupId = randomUUID();
  await prisma.inventoryMovement.createMany({
    data: [
      {
        itemId: state.finishedItemId,
        warehouseId: state.sourceWarehouseId,
        status: "AVAILABLE",
        quantity: `-${quantity}`,
        canonicalUnitId: pieces.id,
        movementType: "STATUS_OUT",
        referenceType: "E2E_PARTIAL_WORKFLOW_FIXTURE",
        referenceId: groupId,
        sourceKey: `E2E-PARTIAL:${suffix}:OUT`,
        groupId,
        reason: "E2E fixture establishes controlled workflow custody.",
        createdByUserId: state.actorUserId,
        productionLotId: state.productionLotId,
      },
      {
        itemId: state.finishedItemId,
        warehouseId: state.sourceWarehouseId,
        status,
        quantity,
        canonicalUnitId: pieces.id,
        movementType: "STATUS_IN",
        referenceType: "E2E_PARTIAL_WORKFLOW_FIXTURE",
        referenceId: groupId,
        sourceKey: `E2E-PARTIAL:${suffix}:IN`,
        groupId,
        reason: "E2E fixture establishes controlled workflow custody.",
        createdByUserId: state.actorUserId,
        productionLotId: state.productionLotId,
      },
    ],
  });
}
const reprocess = new PrismaReprocessRepository();
const awaitingReprocessId = await reprocess.createDraft({
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
  reason: "E2E independent quality review fixture.",
  actorUserId: state.actorUserId,
});
await reprocess.reserve(awaitingReprocessId, state.actorUserId);
await reprocess.start(awaitingReprocessId, state.actorUserId);
const batch = await new PrismaProductionBatchRepository().getBatch(
  (await prisma.reprocessDocument.findUniqueOrThrow({ where: { id: awaitingReprocessId } }))
    .linkedProductionBatchId,
);
const materialRequirement = batch!.materialRequirements[0]!;
const packagingRequirement = batch!.packagingRequirements[0]!;
const packagingLot = await prisma.inventoryMovement.findFirstOrThrow({
  where: { itemId: state.packagingItemId, inventoryLotId: { not: null }, quantity: { gt: 0 } },
  select: { inventoryLotId: true },
});
const materials = new PrismaProductionMaterialRepository();
for (const transactionType of ["ISSUE", "CONSUMPTION"] as const) {
  const id = await materials.createTransaction({
    productionBatchId: batch!.id,
    transactionType,
    transactionDate: "2026-09-13",
    batchRequirementId: materialRequirement.id,
    inventoryLotId: state.rawInventoryLotId,
    quantity: "10",
    unitId: materialRequirement.canonicalUnitId,
    destinationWarehouseId: transactionType === "ISSUE" ? state.sourceWarehouseId : undefined,
    actorUserId: state.actorUserId,
  });
  await materials.postTransaction(id, state.actorUserId);
}
const packaging = new PrismaProductionPackagingRepository();
for (const transactionType of ["ISSUE", "CONSUMPTION"] as const) {
  const id = await packaging.createTransaction({
    productionBatchId: batch!.id,
    transactionType,
    transactionDate: "2026-09-13",
    packagingRequirementId: packagingRequirement.id,
    inventoryLotId: packagingLot.inventoryLotId!,
    quantity: "1",
    unitId: packagingRequirement.canonicalUnitId,
    destinationWarehouseId: transactionType === "ISSUE" ? state.sourceWarehouseId : undefined,
    actorUserId: state.actorUserId,
  });
  await packaging.postTransaction(id, state.actorUserId);
}
const outputs = new PrismaProductionOutputRepository();
const outputId = await outputs.createTransaction({
  productionBatchId: batch!.id,
  outputType: "GOOD",
  transactionDate: "2026-09-13T08:00:00.000Z",
  cartons: "0",
  loosePieces: "1",
  productionDate: "2026-09-13",
  destinationWarehouseId: state.sourceWarehouseId,
  actorUserId: state.actorUserId,
});
await outputs.postTransaction(outputId, state.actorUserId);
await outputs.completeBatch(batch!.id, state.actorUserId);
await new PrismaInventoryValuationRepository().finalizeBatchCost(batch!.id, state.actorUserId);
mkdirSync(path.dirname(e2eStatePath), { recursive: true });
writeFileSync(e2eStatePath, JSON.stringify({ ...state, awaitingReprocessId }, null, 2), "utf8");
await prisma.$disconnect();
console.log(`Phase 27 E2E workflow fixture ready at ${e2eStatePath}.`);
