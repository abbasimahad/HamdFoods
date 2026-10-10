import { describe, expect, it } from "vitest";

import { calculateOutputReconciliation, completionExplanationReasons } from "./output-calculations";

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
