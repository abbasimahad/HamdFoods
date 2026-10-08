import { describe, expect, it, vi } from "vitest";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { RecipeUnit } from "./contracts";
import type { ProductionBatchRepository } from "./batch-contracts";
import { saveProductionBatch } from "./manage-batches";
import { suggestedPlannedPieces } from "../domain/batch-calculations";

const actor: ApplicationPrincipal = {
  id: "00000000-0000-4000-8000-000000000001",
  active: true,
  email: "production@example.com",
  name: "Production Manager",
  roleCodes: ["PRODUCTION_MANAGER"],
  permissions: ["production.manage"],
};

const form = {
  recipeId: "00000000-0000-4000-8000-000000000005",
  plannedBatchQuantity: "40",
  plannedBatchUnitId: "00000000-0000-4000-8000-000000000004",
  plannedProductionDate: "2026-10-09",
  rawMaterialWarehouseId: "00000000-0000-4000-8000-000000000006",
  packagingWarehouseId: "00000000-0000-4000-8000-000000000007",
  finishedGoodsDestinationWarehouseId: "00000000-0000-4000-8000-000000000008",
};

const unit = (id: string, code: string, dimension: RecipeUnit["dimension"]): RecipeUnit => ({
  id,
  code,
  name: code,
  symbol: code.toLowerCase(),
  dimension,
  active: true,
});
const units = [
  unit("l", "L", "VOLUME"),
  unit("ml", "ML", "VOLUME"),
  unit("kg", "KG", "MASS"),
  unit("g", "G", "MASS"),
];

describe("BUG-37: a batch must plan more than 0 pieces", () => {
  it("refuses 0 cartons and 0 loose pieces before reaching the repository", async () => {
    const repository = { createBatch: vi.fn(), updateBatch: vi.fn() };
    const result = await saveProductionBatch(
      actor,
      { ...form, plannedCartons: "0", plannedLoosePieces: "0" },
      repository as unknown as ProductionBatchRepository,
    );
    expect(result).toEqual({ ok: false, message: "Planned output must be more than 0 pieces." });
    expect(repository.createBatch).not.toHaveBeenCalled();
  });

  it("accepts a plan of loose pieces only", async () => {
    const repository = { createBatch: vi.fn().mockResolvedValue("batch-id"), updateBatch: vi.fn() };
    const result = await saveProductionBatch(
      actor,
      { ...form, plannedCartons: "0", plannedLoosePieces: "40" },
      repository as unknown as ProductionBatchRepository,
    );
    expect(result).toEqual({ ok: true, id: "batch-id" });
  });

  it("suggests the pieces a standard batch yields from expected output and content", () => {
    // 40 L expected juice in 1,000 ml bottles -> 40 bottles.
    expect(
      suggestedPlannedPieces(
        { quantity: "40", unitId: "l" },
        { quantity: "1000", unitId: "ml" },
        units,
      ),
    ).toBe(40);
    // 12.7 kg ketchup in 500 g bottles -> 25 bottles; a part bottle rounds down.
    expect(
      suggestedPlannedPieces(
        { quantity: "12.7", unitId: "kg" },
        { quantity: "500", unitId: "g" },
        units,
      ),
    ).toBe(25);
    // No expected output, or output measured unlike the content: no suggestion.
    expect(suggestedPlannedPieces(null, { quantity: "1", unitId: "l" }, units)).toBeNull();
    expect(
      suggestedPlannedPieces(
        { quantity: "40", unitId: "kg" },
        { quantity: "1", unitId: "l" },
        units,
      ),
    ).toBeNull();
  });
});
