import { describe, expect, it } from "vitest";

import { allocateByWeights, calculateProductionCostTotals, derivedCartonCost } from "./costing";

describe("exact costing", () => {
  it("allocates the final rounding remainder without losing value", () => {
    const allocations = allocateByWeights("100", ["1", "1", "1"]);
    expect(allocations).toEqual(["33.333333", "33.333333", "33.333334"]);
  });

  it("calculates the finished-goods pool and actual output costs", () => {
    expect(
      calculateProductionCostTotals({
        reprocessSourceCost: "0",
        rawMaterialCost: "100000",
        packagingCost: "20000",
        additionalCosts: ["20000", "5000", "3000", "7000", "2000"],
        credits: "5000",
        actualGoodPieces: "2362",
        piecesPerCarton: 24,
      }),
    ).toEqual({
      finishedGoodsCostPool: "152000.000000",
      costPerPiece: "64.352243861135",
      costPerCarton: "1544.453853",
    });
  });

  it("capitalizes source finished-good value into a reprocess output without duplicating it", () => {
    expect(
      calculateProductionCostTotals({
        reprocessSourceCost: "500",
        rawMaterialCost: "10",
        packagingCost: "5",
        additionalCosts: ["20"],
        credits: "0",
        actualGoodPieces: "1",
        piecesPerCarton: 24,
      }),
    ).toMatchObject({ finishedGoodsCostPool: "535.000000", costPerPiece: "535.000000000000" });
  });

  it("derives carton cost from authoritative piece cost", () => {
    expect(derivedCartonCost("220", 24)).toBe("5280.000000");
  });
});
