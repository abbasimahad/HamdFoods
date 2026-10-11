import { describe, expect, it } from "vitest";

import { reprocessPlanDefaults } from "./reprocess-plan";

// Mango juice: 20 kg standard batch expected to give 40 bottles, 12 a carton.
const juice = {
  standardBatchQuantity: "20",
  expectedPiecesPerStandardBatch: "40",
  piecesPerCarton: 12,
};

describe("reprocessPlanDefaults (BUG-40)", () => {
  it("plans exactly the bottles being reprocessed, with a batch size scaled to them", () => {
    expect(reprocessPlanDefaults("2", juice)).toEqual({
      batchQuantity: "1",
      cartons: "0",
      loosePieces: "2",
    });
    expect(reprocessPlanDefaults("30", juice)).toEqual({
      batchQuantity: "15",
      cartons: "2",
      loosePieces: "6",
    });
    expect(reprocessPlanDefaults("3", juice).batchQuantity).toBe("1.5");
  });

  it("keeps the standard batch when the recipe has no expected pieces", () => {
    expect(reprocessPlanDefaults("2", { ...juice, expectedPiecesPerStandardBatch: null })).toEqual({
      batchQuantity: "20",
      cartons: "0",
      loosePieces: "2",
    });
  });

  it("asks for the pieces when the source quantity is missing", () => {
    expect(reprocessPlanDefaults("", juice)).toEqual({
      batchQuantity: "20",
      cartons: "0",
      loosePieces: "",
    });
    expect(reprocessPlanDefaults("2", undefined)).toEqual({
      batchQuantity: "",
      cartons: "0",
      loosePieces: "",
    });
  });
});
