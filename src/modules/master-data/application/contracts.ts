import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

import type { ItemType, PackagingKind, UnitDimension } from "../domain/master-data";

export type ListQuery = { query: string; page: number; pageSize: number };
export type PaginatedResult<RecordType> = {
  records: readonly RecordType[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

export type UnitRecord = {
  id: string;
  code: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  active: boolean;
};

export type CategoryRecord = {
  id: string;
  code: string;
  name: string;
  itemType: ItemType;
  description: string | null;
  active: boolean;
};

export type ItemRecord = {
  id: string;
  code: string;
  name: string;
  itemType: ItemType;
  categoryId: string;
  categoryName: string;
  stockUnitId: string;
  stockUnitSymbol: string;
  packagingKind: PackagingKind | null;
  description: string | null;
  active: boolean;
  finishedGoodProfile: {
    netContentQuantity: string;
    netContentUnitId: string;
    netContentUnitCode: string;
    netContentUnitSymbol: string;
    netContentUnitDimension: UnitDimension;
    netContentUnitActive: boolean;
    piecesPerCarton: number;
  } | null;
};

export type UnitInput = {
  id?: string | undefined;
  code: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
};

export type CategoryInput = {
  id?: string | undefined;
  code: string;
  name: string;
  itemType: ItemType;
  description?: string | undefined;
};

type ItemBaseInput = {
  id?: string | undefined;
  code: string;
  name: string;
  categoryId: string;
  stockUnitId: string;
  description?: string | undefined;
};

export type ItemInput =
  | (ItemBaseInput & { itemType: "RAW_MATERIAL" })
  | (ItemBaseInput & { itemType: "PACKAGING_MATERIAL"; packagingKind: PackagingKind })
  | (ItemBaseInput & {
      itemType: "FINISHED_GOOD";
      netContentQuantity: string;
      netContentUnitId: string;
      piecesPerCarton: number;
    });

export type MasterDataRepository = {
  listUnits(query: ListQuery): Promise<PaginatedResult<UnitRecord>>;
  listCategories(query: ListQuery, itemType?: ItemType): Promise<PaginatedResult<CategoryRecord>>;
  listItems(itemType: ItemType, query: ListQuery): Promise<PaginatedResult<ItemRecord>>;
  listActiveUnits(dimensions?: readonly UnitDimension[]): Promise<readonly UnitRecord[]>;
  listActiveCategories(itemType: ItemType): Promise<readonly CategoryRecord[]>;
  getCategory(id: string): Promise<CategoryRecord | null>;
  getUnit(id: string): Promise<UnitRecord | null>;
  saveUnit(input: UnitInput): Promise<string>;
  saveCategory(input: CategoryInput): Promise<string>;
  saveItem(input: ItemInput): Promise<string>;
  setUnitActive(id: string, active: boolean): Promise<boolean>;
  setCategoryActive(id: string, active: boolean): Promise<boolean>;
  setItemActive(id: string, itemType: ItemType, active: boolean): Promise<boolean>;
};

export type MasterMutationResult =
  | { ok: true; id?: string }
  | {
      ok: false;
      reason: "forbidden" | "validation" | "not-found" | "invalid-reference" | "conflict";
      message: string;
    };

export function forbiddenUnlessManage(actor: ApplicationPrincipal): MasterMutationResult | null {
  return actor.active && actor.permissions.includes("inventory.manage")
    ? null
    : { ok: false, reason: "forbidden", message: "You cannot manage inventory master data." };
}

export class MasterDataRepositoryError extends Error {
  constructor(
    readonly reason: "not-found" | "invalid-reference" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "MasterDataRepositoryError";
  }
}

export function repositoryFailure(error: unknown): MasterMutationResult {
  if (error instanceof MasterDataRepositoryError) {
    return { ok: false, reason: error.reason, message: error.message };
  }
  return {
    ok: false,
    reason: "conflict",
    message: "The change could not be saved. Check for duplicate codes and try again.",
  };
}
