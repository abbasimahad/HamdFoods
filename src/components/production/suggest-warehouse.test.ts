import { describe, expect, it } from "vitest";

import { suggestWarehouse, WAREHOUSE_PURPOSE } from "./suggest-warehouse";

const warehouse = (id: string, code: string, name: string, stocked = {}) => ({
  id,
  code,
  name,
  active: true,
  stockedItemCounts: stocked,
});

describe("suggestWarehouse (UX-9, batch and reprocess forms)", () => {
  // Alphabetical order puts the finished-goods store first.
  const warehouses = [
    warehouse("fg", "FG", "Finished Goods Store"),
    warehouse("pack", "PK", "Packaging Store"),
    warehouse("raw", "RM", "Raw Material Store"),
  ];

  it("matches warehouses by purpose when none holds stock yet", () => {
    expect(suggestWarehouse(warehouses, "RAW_MATERIAL", WAREHOUSE_PURPOSE.RAW_MATERIAL)).toBe(
      "raw",
    );
    expect(
      suggestWarehouse(warehouses, "PACKAGING_MATERIAL", WAREHOUSE_PURPOSE.PACKAGING_MATERIAL),
    ).toBe("pack");
    expect(suggestWarehouse(warehouses, "FINISHED_GOOD", WAREHOUSE_PURPOSE.FINISHED_GOOD)).toBe(
      "fg",
    );
  });

  it("prefers the warehouse that actually holds that kind of stock", () => {
    const stocked = [
      warehouse("fg", "FG", "Finished Goods Store", { FINISHED_GOOD: 2 }),
      warehouse("main", "MAIN", "Main Store", { RAW_MATERIAL: 5, PACKAGING_MATERIAL: 3 }),
      warehouse("raw", "RM", "Raw Material Store"),
    ];
    expect(suggestWarehouse(stocked, "RAW_MATERIAL", WAREHOUSE_PURPOSE.RAW_MATERIAL)).toBe("main");
    expect(
      suggestWarehouse(stocked, "PACKAGING_MATERIAL", WAREHOUSE_PURPOSE.PACKAGING_MATERIAL),
    ).toBe("main");
  });

  it("does not treat words merely containing 'rm' or 'fg' as a match", () => {
    expect(WAREHOUSE_PURPOSE.RAW_MATERIAL.test("Farm Gate Store")).toBe(false);
    expect(WAREHOUSE_PURPOSE.FINISHED_GOOD.test("CFGX Dock")).toBe(false);
  });
});
