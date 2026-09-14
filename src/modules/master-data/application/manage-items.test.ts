import { describe, expect, it } from "vitest";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

import type { CategoryRecord, ItemInput, MasterDataRepository, UnitRecord } from "./contracts";
import { saveItem } from "./manage-items";

const actor: ApplicationPrincipal = {
  id: "user-1",
  name: "Inventory manager",
  email: "inventory@example.com",
  active: true,
  roleCodes: ["ADMIN"],
  permissions: ["inventory.manage"],
};

const category: CategoryRecord = {
  id: "fg-category",
  code: "FG",
  name: "Finished goods",
  itemType: "FINISHED_GOOD",
  description: null,
  active: true,
};

const pieces: UnitRecord = {
  id: "pcs",
  code: "PCS",
  name: "Pieces",
  symbol: "pcs",
  dimension: "COUNT",
  active: true,
};

const grams: UnitRecord = {
  id: "g",
  code: "G",
  name: "Grams",
  symbol: "g",
  dimension: "MASS",
  active: true,
};

function repository(saved: ItemInput[]): MasterDataRepository {
  return {
    listUnits: async () => ({ records: [], page: 1, pageSize: 20, total: 0, pageCount: 1 }),
    listCategories: async () => ({
      records: [],
      page: 1,
      pageSize: 20,
      total: 0,
      pageCount: 1,
    }),
    listItems: async () => ({ records: [], page: 1, pageSize: 20, total: 0, pageCount: 1 }),
    listActiveUnits: async () => [pieces, grams],
    listActiveCategories: async () => [category],
    getCategory: async (id) => (id === category.id ? category : null),
    getUnit: async (id) => (id === pieces.id ? pieces : id === grams.id ? grams : null),
    saveUnit: async () => "unit",
    saveCategory: async () => "category",
    saveItem: async (input) => {
      saved.push(input);
      return "finished-good";
    },
    setUnitActive: async () => true,
    setCategoryActive: async () => true,
    setItemActive: async () => true,
  };
}

function finishedGood(reprocessShelfLifeDays?: unknown) {
  return {
    itemType: "FINISHED_GOOD",
    code: "FG-001",
    name: "Test finished good",
    categoryId: category.id,
    stockUnitId: pieces.id,
    netContentQuantity: "100",
    netContentUnitId: grams.id,
    piecesPerCarton: 12,
    ...(reprocessShelfLifeDays === undefined ? {} : { reprocessShelfLifeDays }),
  };
}

describe("finished-good reprocess shelf-life policy", () => {
  it("keeps the policy nullable for existing finished goods", async () => {
    // Defect caught: a required/defaulted field would invalidate or silently invent policy for old products.
    const saved: ItemInput[] = [];

    expect(await saveItem(actor, finishedGood(), repository(saved))).toEqual({
      ok: true,
      id: "finished-good",
    });
    expect(saved[0]).not.toHaveProperty("reprocessShelfLifeDays");
  });

  it.each([0, -1, 1.5, 3651])("rejects unsafe shelf-life day value %s", async (value) => {
    // Defect caught: zero, fractional, negative, or implausibly large shelf-life could authorize unsafe stock.
    const saved: ItemInput[] = [];

    expect(await saveItem(actor, finishedGood(value), repository(saved))).toMatchObject({
      ok: false,
      reason: "validation",
    });
    expect(saved).toHaveLength(0);
  });

  it("persists a configured whole-day product policy", async () => {
    // Defect caught: validation could accept the policy but drop it before the repository snapshot authority.
    const saved: ItemInput[] = [];

    expect(await saveItem(actor, finishedGood(60), repository(saved))).toMatchObject({ ok: true });
    expect(saved[0]).toMatchObject({ reprocessShelfLifeDays: 60 });
  });
});
