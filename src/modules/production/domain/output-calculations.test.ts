import { describe, expect, it } from "vitest";

import {
  calculateOutputReconciliation,
  completionExplanationReasons,
  defaultExpiryDate,
  remainingPlannedOutput,
} from "./output-calculations";

// Mango juice: kg pulp and sugar plus L water into 1 L bottles -> no common input basis.
const juiceReconciliation = calculateOutputReconciliation({
  basisDimension: "VOLUME",
  inputComponents: [
    { dimension: "MASS", quantity: "6000" },
    { dimension: "VOLUME", quantity: "18000" },
  ],
  goodOutput: "24000",
  reprocessOutput: "0",
  rejectedOutput: "0",
  processLoss: "0",
  expectedYieldPercent: null,
});

const base = {
  batchType: "NORMAL" as const,
  plannedPieces: "24",
  goodPieces: "24",
  nonGoodOutputPosted: false,
  unreconciledDifference: juiceReconciliation.unreconciledDifference,
  contentUnitSymbol: "ml",
  packagingWarnings: [],
};

describe("completionExplanationReasons (CTRL-1 / UX-11)", () => {
  it("asks nothing of a mixed kg/L batch that produced exactly its plan", () => {
    expect(juiceReconciliation.compatible).toBe(false);
    expect(completionExplanationReasons(base)).toEqual([]);
  });

  it("asks for a shortfall with no loss, reject or reprocess output posted", () => {
    expect(completionExplanationReasons({ ...base, goodPieces: "20" })).toEqual([
      "Good output is 4 piece(s) short of plan with no REJECTED, PROCESS LOSS or REPROCESS output posted.",
    ]);
    expect(
      completionExplanationReasons({ ...base, goodPieces: "20", nonGoodOutputPosted: true }),
    ).toEqual([]);
  });

  it("asks for a real input/output difference and packaging differences", () => {
    expect(
      completionExplanationReasons({
        ...base,
        unreconciledDifference: "250",
        packagingWarnings: ["CAP good consumption differs from actual-output standard by 2 pcs."],
      }),
    ).toEqual([
      "Input and output differ by 250 ml.",
      "CAP good consumption differs from actual-output standard by 2 pcs.",
    ]);
    expect(completionExplanationReasons({ ...base, unreconciledDifference: "0" })).toEqual([]);
  });

  it("never asks a reprocess batch", () => {
    expect(
      completionExplanationReasons({ ...base, batchType: "REPROCESS", goodPieces: "1" }),
    ).toEqual([]);
  });
});

describe("output form defaults (BUG-39)", () => {
  it("dates expiry from production date plus shelf life", () => {
    expect(defaultExpiryDate("2026-10-10", 180)).toBe("2027-04-08");
    expect(defaultExpiryDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(defaultExpiryDate("2026-10-10", null)).toBe("");
    expect(defaultExpiryDate("", 180)).toBe("");
  });

  it("offers the good output still to record against the plan", () => {
    expect(remainingPlannedOutput("40", "0", 12)).toEqual({ cartons: "3", loosePieces: "4" });
    expect(remainingPlannedOutput("40", "12", 12)).toEqual({ cartons: "2", loosePieces: "4" });
    expect(remainingPlannedOutput("40", "45", 12)).toEqual({ cartons: "0", loosePieces: "0" });
  });
});
