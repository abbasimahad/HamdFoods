import { beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { PrismaProductionBatchRepository } from "@/server/production/prisma-production-batch-repository";
import { executePhase27GoldenWorkflow, type Phase27WorkflowState } from "./phase27-golden-workflow";

let state: Phase27WorkflowState;

beforeAll(async () => {
  state = await executePhase27GoldenWorkflow();
});

describe("round-7 bug-log regressions", () => {
  it("BUG-37: a batch with 0 planned pieces can be neither created nor released", async () => {
    const batches = new PrismaProductionBatchRepository();
    const grams = await prisma.unit.findFirstOrThrow({ where: { code: "G" } });
    const plan = {
      recipeId: state.recipeId,
      plannedBatchQuantity: "1000",
      plannedBatchUnitId: grams.id,
      plannedProductionDate: "2026-10-09",
      targetCompletionDate: "2026-10-10",
      rawMaterialWarehouseId: state.sourceWarehouseId,
      packagingWarehouseId: state.sourceWarehouseId,
      finishedGoodsDestinationWarehouseId: state.sourceWarehouseId,
      notes: "BUG-37 zero planned output regression.",
      actorUserId: state.actorUserId,
    };
    await expect(
      batches.createBatch({ ...plan, plannedCartons: "0", plannedLoosePieces: "0" }),
    ).rejects.toThrow("Planned output must be more than 0 pieces.");

    // A draft saved before the rule (like BATCH-2026-000007) can be neither planned nor released.
    const batchId = await batches.createBatch({
      ...plan,
      plannedCartons: "0",
      plannedLoosePieces: "2",
    });
    const zeroPlan = { plannedTotalPieces: 0, plannedLoosePieces: 0, plannedCartons: 0 };
    await prisma.productionBatch.update({ where: { id: batchId }, data: zeroPlan });
    await expect(batches.planBatch(batchId, state.actorUserId)).rejects.toThrow(
      "Planned output must be more than 0 pieces.",
    );
    await prisma.productionBatch.update({ where: { id: batchId }, data: { status: "PLANNED" } });
    await expect(batches.releaseBatch(batchId, state.actorUserId, true)).rejects.toThrow(
      "Planned output must be more than 0 pieces.",
    );
    expect(
      (await prisma.productionBatch.findUniqueOrThrow({ where: { id: batchId } })).status,
    ).toBe("PLANNED");
  });

  it("BUG-37: approved recipes offer a planned-pieces default", async () => {
    const recipes = await new PrismaProductionBatchRepository().listApprovedRecipes();
    const recipe = recipes.find((candidate) => candidate.id === state.recipeId);
    expect(recipe).toBeDefined();
    expect(Number(recipe!.standardBatchNormalizedQuantity)).toBeGreaterThan(0);
    if (recipe!.expectedPiecesPerStandardBatch !== null)
      expect(Number(recipe!.expectedPiecesPerStandardBatch)).toBeGreaterThan(0);
  });
});
