import { describe, expect, it } from "vitest";

import { validateWasteDispositionLine, validateWasteReversal } from "./waste-disposition";

const valid = {
  itemType: "FINISHED_GOOD",
  sourceStatus: "DAMAGED",
  action: "MOVE_TO_SCRAP",
  reason: "DAMAGED",
  notes: undefined,
  quantity: "2",
  eligibleQuantity: "3",
  inventoryLotId: null,
  productionLotId: "lot-1",
  sourceExpiry: new Date("2026-12-31T00:00:00.000Z"),
  reprocessShelfLifeDays: 60,
  today: new Date("2026-09-13T00:00:00.000Z"),
} as const;

describe("waste disposition policy", () => {
  it.each([
    ["MOVE_TO_SCRAP", "DAMAGED", "SCRAP"],
    ["MOVE_TO_SCRAP", "QUARANTINE", "SCRAP"],
    ["MOVE_TO_REPROCESS", "DAMAGED", "REPROCESS"],
    ["MOVE_TO_REPROCESS", "QUARANTINE", "REPROCESS"],
    ["WRITE_OFF", "DAMAGED", null],
    ["WRITE_OFF", "SCRAP", null],
  ])("allows %s from %s", (action, sourceStatus, destinationStatus) => {
    expect(validateWasteDispositionLine({ ...valid, action, sourceStatus })).toMatchObject({
      destinationStatus,
    });
  });

  it.each([
    ["MOVE_TO_SCRAP", "AVAILABLE"],
    ["MOVE_TO_REPROCESS", "SCRAP"],
    ["WRITE_OFF", "QUARANTINE"],
  ])("rejects %s from %s", (action, sourceStatus) => {
    expect(() => validateWasteDispositionLine({ ...valid, action, sourceStatus })).toThrow(
      "not allowed",
    );
  });

  it("requires a positive available lot-specific quantity", () => {
    expect(() => validateWasteDispositionLine({ ...valid, quantity: "0" })).toThrow(
      "greater than zero",
    );
    expect(() => validateWasteDispositionLine({ ...valid, quantity: "4" })).toThrow("exceeds");
    expect(() =>
      validateWasteDispositionLine({
        ...valid,
        inventoryLotId: "inventory-lot",
        productionLotId: "production-lot",
      }),
    ).toThrow("exactly one lot");
  });

  it("requires notes for OTHER while keeping action separate from reason", () => {
    expect(() => validateWasteDispositionLine({ ...valid, reason: "OTHER" })).toThrow(
      "Notes are required",
    );
    expect(
      validateWasteDispositionLine({ ...valid, reason: "OTHER", notes: "Confirmed spoilage." }),
    ).toMatchObject({ destinationStatus: "SCRAP" });
  });

  it("reuses the Reprocess eligibility policy for MOVE_TO_REPROCESS", () => {
    expect(() =>
      validateWasteDispositionLine({
        ...valid,
        action: "MOVE_TO_REPROCESS",
        itemType: "RAW_MATERIAL",
        inventoryLotId: "inventory-lot",
        productionLotId: null,
      }),
    ).toThrow("Only finished goods");
    expect(() =>
      validateWasteDispositionLine({
        ...valid,
        action: "MOVE_TO_REPROCESS",
        reprocessShelfLifeDays: null,
      }),
    ).toThrow("Configure");
    expect(() =>
      validateWasteDispositionLine({
        ...valid,
        action: "MOVE_TO_REPROCESS",
        sourceExpiry: new Date("2026-09-12T00:00:00.000Z"),
      }),
    ).toThrow("Expired");
  });
});

describe("waste disposition reversal policy", () => {
  it("requires the exact destination quantity and blocks a claimed REPROCESS handoff", () => {
    expect(() =>
      validateWasteReversal({
        action: "MOVE_TO_SCRAP",
        quantity: "2",
        destinationBalance: "1",
        downstreamReprocessClaims: 0,
      }),
    ).toThrow("exact original quantity");
    expect(() =>
      validateWasteReversal({
        action: "MOVE_TO_REPROCESS",
        quantity: "2",
        destinationBalance: "2",
        downstreamReprocessClaims: 1,
      }),
    ).toThrow("claimed by Reprocess");
  });

  it("allows intact status moves and an original-value write-off restoration", () => {
    expect(
      validateWasteReversal({
        action: "MOVE_TO_SCRAP",
        quantity: "2",
        destinationBalance: "2",
        downstreamReprocessClaims: 0,
      }),
    ).toEqual({ quantity: "2" });
    expect(
      validateWasteReversal({
        action: "WRITE_OFF",
        quantity: "2",
        destinationBalance: "0",
        downstreamReprocessClaims: 0,
        originalValue: "12.345678",
        originalUnitCost: "6.172839",
      }),
    ).toMatchObject({ originalValue: "12.345678" });
  });
});
