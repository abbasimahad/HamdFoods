import type { ItemType, UnitDimension } from "../domain/master-data";

export const STANDARD_UNITS: readonly {
  code: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
}[] = [
  { code: "KG", name: "Kilogram", symbol: "kg", dimension: "MASS" },
  { code: "G", name: "Gram", symbol: "g", dimension: "MASS" },
  { code: "L", name: "Litre", symbol: "L", dimension: "VOLUME" },
  { code: "ML", name: "Millilitre", symbol: "ml", dimension: "VOLUME" },
  { code: "PCS", name: "Piece", symbol: "pcs", dimension: "COUNT" },
];

export const DEFAULT_ITEM_CATEGORIES: readonly {
  code: string;
  name: string;
  itemType: ItemType;
}[] = [
  { code: "INGREDIENTS", name: "Ingredients", itemType: "RAW_MATERIAL" },
  { code: "SPICES", name: "Spices", itemType: "RAW_MATERIAL" },
  { code: "PRESERVATIVES", name: "Preservatives", itemType: "RAW_MATERIAL" },
  { code: "BOTTLES", name: "Bottles", itemType: "PACKAGING_MATERIAL" },
  { code: "CAPS", name: "Caps", itemType: "PACKAGING_MATERIAL" },
  { code: "LABELS", name: "Labels", itemType: "PACKAGING_MATERIAL" },
  { code: "CARTONS", name: "Cartons", itemType: "PACKAGING_MATERIAL" },
  { code: "KETCHUP", name: "Ketchup", itemType: "FINISHED_GOOD" },
  { code: "PICKLES", name: "Pickles", itemType: "FINISHED_GOOD" },
  { code: "JUICES", name: "Juices", itemType: "FINISHED_GOOD" },
  { code: "SAUCES", name: "Sauces", itemType: "FINISHED_GOOD" },
];

export type MasterDataSeedStore = {
  upsertUnit(input: (typeof STANDARD_UNITS)[number]): Promise<void>;
  upsertCategory(input: (typeof DEFAULT_ITEM_CATEGORIES)[number]): Promise<void>;
};

export async function seedMasterData(store: MasterDataSeedStore) {
  for (const unit of STANDARD_UNITS) await store.upsertUnit(unit);
  for (const category of DEFAULT_ITEM_CATEGORIES) await store.upsertCategory(category);
  return { units: STANDARD_UNITS.length, categories: DEFAULT_ITEM_CATEGORIES.length };
}
