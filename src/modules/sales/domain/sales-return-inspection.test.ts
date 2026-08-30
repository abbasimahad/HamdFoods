import { describe, expect, it } from "vitest";

import { inspectionClassificationsReconcile } from "./sales-return-inspection";

describe("sales-return inspection reconciliation", () => {
  it("accepts classifications that exactly equal the returned quantity", () => {
    expect(inspectionClassificationsReconcile("100", ["60", "20", "10", "10"])).toBe(true);
  });

  it.each([
    [["60", "20", "10", "9"], false],
    [["60", "20", "10", "11"], false],
  ])("rejects under- and over-classification", (classifications, expected) => {
    expect(inspectionClassificationsReconcile("100", classifications)).toBe(expected);
  });
});
