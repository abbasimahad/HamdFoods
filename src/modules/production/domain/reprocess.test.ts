import { describe, expect, it } from "vitest";

import {
  calculateReprocessChildExpiry,
  reconcileReprocessYield,
  ReprocessDomainError,
  validateReprocessQualityAuthority,
  validateReprocessEligibility,
} from "./reprocess";

const eligible = {
  itemType: "FINISHED_GOOD" as const,
  sourceStatus: "REPROCESS" as const,
  requestedQuantity: "10",
  eligibleQuantity: "10",
  sourceExpiry: new Date("2026-12-31T00:00:00.000Z"),
  reprocessShelfLifeDays: 60,
  today: new Date("2026-09-12T00:00:00.000Z"),
};

function rejection(overrides: Partial<typeof eligible>) {
  try {
    validateReprocessEligibility({ ...eligible, ...overrides });
    return null;
  } catch (error) {
    return error;
  }
}

describe("reprocess eligibility", () => {
  it("accepts exact available REPROCESS finished-good quantity and returns frozen policy data", () => {
    // Defect caught: an eligible lot could be rejected or policy provenance could be omitted before persistence.
    expect(validateReprocessEligibility(eligible)).toEqual({
      requestedQuantity: "10",
      sourceExpirySnapshot: new Date("2026-12-31T00:00:00.000Z"),
      shelfLifeDaysSnapshot: 60,
    });
  });

  it("rejects a non-finished-good item", () => {
    // Defect caught: raw or packaging stock could enter the dedicated finished-good source bridge.
    expect(rejection({ itemType: "RAW_MATERIAL" as never })).toMatchObject({
      code: "ITEM_TYPE",
    });
  });

  it("rejects custody other than REPROCESS", () => {
    // Defect caught: direct AVAILABLE or quarantined stock could bypass controlled disposition.
    expect(rejection({ sourceStatus: "AVAILABLE" as never })).toMatchObject({
      code: "SOURCE_STATUS",
    });
  });

  it.each(["0", "-1", "not-a-number"])("rejects invalid quantity %s", (requestedQuantity) => {
    // Defect caught: malformed/nonpositive input could create or reverse stock unexpectedly.
    expect(rejection({ requestedQuantity })).toBeInstanceOf(ReprocessDomainError);
  });

  it("rejects quantity above the lot/status balance", () => {
    // Defect caught: a reservation could overdraw the selected source lot under contention.
    expect(rejection({ requestedQuantity: "10.000001", eligibleQuantity: "10" })).toMatchObject({
      code: "INSUFFICIENT_QUANTITY",
    });
  });

  it("requires configured product shelf-life policy", () => {
    // Defect caught: an operator could start reprocess without an approved maximum shelf life.
    expect(rejection({ reprocessShelfLifeDays: null as never })).toMatchObject({
      code: "SHELF_LIFE_POLICY",
      message:
        "Configure the finished good's reprocess shelf-life policy before starting reprocess.",
    });
  });

  it("requires a source expiry and rejects an already expired lot", () => {
    // Defect caught: missing/expired food provenance could be treated as unlimited or made saleable again.
    expect(rejection({ sourceExpiry: null as never })).toMatchObject({ code: "SOURCE_EXPIRY" });
    expect(rejection({ sourceExpiry: new Date("2026-09-11T00:00:00.000Z") })).toMatchObject({
      code: "SOURCE_EXPIRED",
    });
  });
});

describe("reprocess completion", () => {
  it("uses the policy date when it is earlier than the source expiry", () => {
    expect(
      calculateReprocessChildExpiry(
        new Date("2026-09-13T00:00:00.000Z"),
        60,
        new Date("2027-06-04T00:00:00.000Z"),
      ),
    ).toEqual(new Date("2026-11-12T00:00:00.000Z"));
  });

  it("never extends beyond an earlier source expiry", () => {
    expect(
      calculateReprocessChildExpiry(
        new Date("2026-09-13T00:00:00.000Z"),
        60,
        new Date("2026-10-01T00:00:00.000Z"),
      ),
    ).toEqual(new Date("2026-10-01T00:00:00.000Z"));
  });

  it("requires exact GOOD plus scrap plus documented loss reconciliation", () => {
    expect(
      reconcileReprocessYield({ source: "500", good: "450", scrap: "25", processLoss: "25" }),
    ).toEqual({ source: "500", accounted: "500" });
    expect(() =>
      reconcileReprocessYield({ source: "500", good: "450", scrap: "25", processLoss: "24" }),
    ).toThrow("must exactly equal");
  });
});

describe("reprocess quality segregation", () => {
  it("requires the inspector to differ from both initiator and completer without bypass", () => {
    expect(() => validateReprocessQualityAuthority("user-a", "user-a", "user-b")).toThrow(
      "Another authorized quality user",
    );
    expect(() => validateReprocessQualityAuthority("user-b", "user-a", "user-b")).toThrow(
      "Another authorized quality user",
    );
    expect(() => validateReprocessQualityAuthority("quality", "user-a", "user-b")).not.toThrow();
  });
});
