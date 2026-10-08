import type { BatchWarehouseOption } from "@/modules/production/application/batch-contracts";

/**
 * UX-9: the first warehouse alphabetically is usually the finished-goods store, which is the
 * wrong default for raw materials and packaging. Prefer the warehouse that actually holds the
 * most items of that kind, then one whose code or name matches its purpose, then one that holds
 * no other kind of stock, and only then the first one.
 */
export function suggestWarehouse(
  warehouses: readonly BatchWarehouseOption[],
  itemType: "RAW_MATERIAL" | "PACKAGING_MATERIAL" | "FINISHED_GOOD",
  pattern: RegExp,
) {
  const count = (warehouse: BatchWarehouseOption) => warehouse.stockedItemCounts?.[itemType] ?? 0;
  const stocked = warehouses.filter((warehouse) => count(warehouse) > 0);
  stocked.sort((a, b) => count(b) - count(a));
  const holdsOtherStock = (warehouse: BatchWarehouseOption) =>
    Object.entries(warehouse.stockedItemCounts ?? {}).some(
      ([type, lines]) => type !== itemType && (lines ?? 0) > 0,
    );
  return (
    stocked[0]?.id ??
    warehouses.find((warehouse) => pattern.test(`${warehouse.code} ${warehouse.name}`))?.id ??
    warehouses.find((warehouse) => !holdsOtherStock(warehouse))?.id ??
    warehouses[0]?.id ??
    ""
  );
}

/** Default warehouse purpose patterns shared by the batch and reprocess forms. */
export const WAREHOUSE_PURPOSE = {
  RAW_MATERIAL: /raw|rm/i,
  PACKAGING_MATERIAL: /pack/i,
  FINISHED_GOOD: /finish|fg/i,
} as const;
