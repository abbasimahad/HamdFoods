import { describe, expect, it } from "vitest";

import { reconcileMaterial } from "./material-reconciliation";
import { reconcilePackaging } from "./packaging-reconciliation";
import {
  calculateFinalPackagingStandard,
  calculateOutputReconciliation,
  normalizeGoodOutput,
} from "./output-calculations";

describe("production custody reconciliation", () => {
  it.each([
    ["70", "10"],
    ["80", "0"],
  ])("derives held raw material after consuming %s", (consumed, expectedHeld) => {
    expect(
      reconcileMaterial({ planned: "80", issued: "100", returned: "20", consumed }),
    ).toMatchObject({ currentlyInProduction: expectedHeld });
  });

  it("rejects consumption greater than batch-held material", () => {
    expect(() =>
      reconcileMaterial({ planned: "100", issued: "100", returned: "20", consumed: "81" }),
    ).toThrow(/custody/i);
  });

  it("reconciles good and damaged packaging independently", () => {
    expect(
      reconcilePackaging({
        plannedStandard: "2400",
        issued: "2450",
        returned: "20",
        goodConsumed: "2400",
        damaged: "30",
      }),
    ).toEqual({
      currentlyInProduction: "0",
      totalDepleted: "2430",
      provisionalVarianceQuantity: "30",
      provisionalVarianceDirection: "OVER",
      goodConsumptionVarianceQuantity: "0",
      goodConsumptionVarianceDirection: "EXACT",
    });
  });
});

describe("production output and yield", () => {
  const profile = {
    netContentQuantity: "1",
    netContentUnit: { code: "KG", symbol: "kg", dimension: "MASS" as const, active: true },
    piecesPerCarton: 24,
    netContentUnitDimension: "MASS" as const,
  };

  it("normalizes completed output into canonical pieces", () => {
    expect(normalizeGoodOutput("98", "10", profile)).toMatchObject({
      cartons: "98",
      loosePieces: "10",
      totalPieces: "2362",
    });
  });

  it("calculates compatible yield and refuses cross-dimension comparison", () => {
    expect(
      calculateOutputReconciliation({
        basisDimension: "MASS",
        inputComponents: [{ dimension: "MASS", quantity: "1000" }],
        goodOutput: "950",
        reprocessOutput: "0",
        rejectedOutput: "0",
        processLoss: "50",
        expectedYieldPercent: null,
      }),
    ).toMatchObject({ compatible: true, goodYieldPercent: "95" });

    expect(
      calculateOutputReconciliation({
        basisDimension: "MASS",
        inputComponents: [{ dimension: "VOLUME", quantity: "1000" }],
        goodOutput: "950",
        reprocessOutput: "0",
        rejectedOutput: "0",
        processLoss: "50",
        expectedYieldPercent: null,
      }),
    ).toMatchObject({ compatible: false, goodYieldPercent: null });
  });

  it("bases final per-piece packaging standard on actual output", () => {
    expect(calculateFinalPackagingStandard("PER_PIECE", "1", "2362", "98")).toBe("2362");
  });
});
