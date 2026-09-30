import "server-only";

import type { ItemType, Prisma } from "@/generated/prisma/client";
import { ProductionMaterialRepositoryError } from "@/modules/production/application/material-contracts";
import { recordAuditEvent } from "@/server/audit/audit-event";
import { valueProductionConsumption } from "@/server/costing/prisma-inventory-valuation-repository";
import { postProductionMaterialInventory } from "@/server/inventory/transactional-inventory-posting";

/**
 * BUG-31: corrects a POSTED material issue or consumption without touching it. A new POSTED
 * reversal document (same type, `reversalOfId` pointing at the original) posts the mirror image:
 * - issue reversal: the batch-held lot goes back from IN_PRODUCTION to AVAILABLE;
 * - consumption reversal: the consumed quantity returns to batch custody (IN_PRODUCTION) and its
 *   original cost moves back from work-in-process to inventory.
 * The batch must still be open, so a completed/costed batch is never changed after the fact.
 */
export async function reverseMaterialTransaction(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    materialType: Extract<ItemType, "RAW_MATERIAL" | "PACKAGING_MATERIAL">;
    actorUserId: string;
    reason: string;
    nextNumber: (type: "ISSUE" | "CONSUMPTION") => Promise<string>;
  },
): Promise<string> {
  const original = await tx.productionMaterialTransaction.findUnique({
    where: { id: input.id },
    include: {
      productionBatch: true,
      lines: { orderBy: { position: "asc" } },
      reversal: { select: { transactionNumber: true } },
    },
  });
  if (!original || original.materialType !== input.materialType)
    throw new ProductionMaterialRepositoryError("not-found", "Material transaction was not found.");
  if (original.status !== "POSTED" || original.reversalOfId)
    throw new ProductionMaterialRepositoryError(
      "invalid-state",
      "Only a POSTED issue or consumption can be reversed.",
    );
  if (original.reversal)
    throw new ProductionMaterialRepositoryError(
      "invalid-state",
      `${original.transactionNumber} is already reversed by ${original.reversal.transactionNumber}.`,
    );
  const type = original.transactionType;
  if (type !== "ISSUE" && type !== "CONSUMPTION")
    throw new ProductionMaterialRepositoryError(
      "invalid-state",
      "Only issues and consumptions can be reversed. Record a new issue instead of reversing a return.",
    );
  const batchStatus = original.productionBatch.status;
  const batchOpen =
    type === "ISSUE" && input.materialType === "RAW_MATERIAL"
      ? batchStatus === "RELEASED" || batchStatus === "IN_PROGRESS"
      : batchStatus === "IN_PROGRESS";
  if (!batchOpen)
    throw new ProductionMaterialRepositoryError(
      "invalid-state",
      "Material can be reversed only while the batch is still in progress.",
    );
  if ((await tx.user.count({ where: { id: input.actorUserId, active: true } })) !== 1)
    throw new ProductionMaterialRepositoryError("invalid-reference", "Acting user is inactive.");

  const reversal = await tx.productionMaterialTransaction.create({
    data: {
      transactionNumber: await input.nextNumber(type),
      productionBatchId: original.productionBatchId,
      materialType: original.materialType,
      transactionType: type,
      transactionDate: new Date(),
      notes: `Reversal of ${original.transactionNumber}: ${input.reason}`,
      createdByUserId: input.actorUserId,
      reversalOfId: original.id,
      lines: {
        create: original.lines.map((line) => ({
          position: line.position,
          batchRequirementId: line.batchRequirementId,
          packagingRequirementId: line.packagingRequirementId,
          itemId: line.itemId,
          itemType: line.itemType,
          sourceWarehouseId: line.sourceWarehouseId,
          destinationWarehouseId: line.destinationWarehouseId,
          inventoryLotId: line.inventoryLotId,
          enteredQuantity: line.enteredQuantity,
          enteredUnitId: line.enteredUnitId,
          enteredUnitDimension: line.enteredUnitDimension,
          normalizedQuantity: line.normalizedQuantity,
          canonicalUnitId: line.canonicalUnitId,
          canonicalUnitDimension: line.canonicalUnitDimension,
          notes: line.notes,
        })),
      },
    },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  for (const line of reversal.lines)
    await postProductionMaterialInventory(tx, {
      materialType: input.materialType,
      operation: type,
      reversal: true,
      transactionId: reversal.id,
      transactionNumber: reversal.transactionNumber,
      transactionLineId: line.id,
      productionBatchId: reversal.productionBatchId,
      batchNumber: original.productionBatch.batchNumber,
      itemId: line.itemId,
      custodyWarehouseId: line.sourceWarehouseId,
      canonicalUnitId: line.canonicalUnitId,
      quantity: line.normalizedQuantity.toString(),
      inventoryLotId: line.inventoryLotId,
      reason: `Reversal of ${original.transactionNumber}: ${input.reason}`,
      actorUserId: input.actorUserId,
    });
  await valueProductionConsumption(tx, reversal.id, input.actorUserId);
  const postedAt = new Date();
  await tx.productionMaterialTransaction.update({
    where: { id: reversal.id },
    data: { status: "POSTED", postedByUserId: input.actorUserId, postedAt },
  });
  await recordAuditEvent(tx, {
    actorUserId: input.actorUserId,
    action: "REVERSE",
    entityType: "MATERIAL_TRANSACTION",
    entityId: original.id,
    entityReference: original.transactionNumber,
    module: "production",
    description: `Reversed ${type.toLowerCase()} ${original.transactionNumber} with ${reversal.transactionNumber}.`,
    reasonCode: "OPERATIONAL_CORRECTION",
    reason: input.reason,
    metadata: {
      reversalId: reversal.id,
      reversalNumber: reversal.transactionNumber,
      lines: original.lines.map((line) => ({
        itemId: line.itemId,
        inventoryLotId: line.inventoryLotId,
        quantity: line.normalizedQuantity.toString(),
      })),
    },
    beforeSnapshot: { status: "POSTED", reversed: false },
    afterSnapshot: { status: "POSTED", reversed: true, postedAt: postedAt.toISOString() },
    related: {
      entityType: "PRODUCTION_BATCH",
      entityId: original.productionBatchId,
      reference: original.productionBatch.batchNumber,
    },
    controlEvent: true,
  });
  return reversal.id;
}
