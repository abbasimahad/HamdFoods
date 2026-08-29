import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { ItemType, UnitDimension } from "@/modules/master-data/domain/master-data";

import type { ImplementedMovementType, InventoryStatus } from "../domain/inventory";

export type WarehouseRecord = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
};
export type WarehouseInput = Omit<WarehouseRecord, "id" | "active" | "description"> & {
  id?: string | undefined;
  description?: string | undefined;
};
export type InventoryUnitOption = {
  id: string;
  code: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  active: boolean;
};
export type InventoryItemOption = {
  id: string;
  code: string;
  name: string;
  itemType: ItemType;
  stockUnitDimension: UnitDimension;
  piecesPerCarton: number | null;
};
export type PostingQuantityInput = {
  quantity?: string;
  unitId?: string;
  cartons?: string;
  loosePieces?: string;
};
export type SinglePostingCommand = PostingQuantityInput & {
  itemId: string;
  warehouseId: string;
  status: InventoryStatus;
  movementType: "OPENING_BALANCE" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT";
  referenceType: "OPENING_STOCK" | "MANUAL_ADJUSTMENT";
  referenceId?: string;
  sourceKey?: string;
  reason: string;
  actorUserId: string;
  unitCost?: string | undefined;
};
export type WarehouseTransferCommand = PostingQuantityInput & {
  itemId: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  status: InventoryStatus;
  referenceId: string;
  sourceKey?: string;
  reason: string;
  actorUserId: string;
};
export type StatusTransferCommand = PostingQuantityInput & {
  itemId: string;
  warehouseId: string;
  sourceStatus: InventoryStatus;
  destinationStatus: InventoryStatus;
  referenceId: string;
  sourceKey?: string;
  reason: string;
  actorUserId: string;
};
export type MovementHistoryQuery = {
  page: number;
  query: string;
  warehouseId?: string | undefined;
  status?: InventoryStatus | undefined;
  movementType?: ImplementedMovementType | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
};
export type MovementHistoryRecord = {
  id: string;
  postedAt: Date;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  warehouseName: string;
  status: InventoryStatus;
  movementType: string;
  quantity: string;
  canonicalUnitCode: string;
  canonicalUnitSymbol: string;
  canonicalUnitDimension: UnitDimension;
  referenceType: string;
  referenceId: string | null;
  userName: string;
  reason: string;
  supplierLotNumber: string | null;
  piecesPerCarton: number | null;
};
export type StockOverviewRecord = {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  warehouseId: string;
  warehouseName: string;
  availableQuantity: string;
  otherStatusQuantity: string;
  totalQuantity: string;
  canonicalUnitCode: string;
  canonicalUnitSymbol: string;
  canonicalUnitDimension: UnitDimension;
  piecesPerCarton: number | null;
};
export type PageResult<T> = {
  records: readonly T[];
  page: number;
  pageCount: number;
  total: number;
};

export interface InventoryRepository {
  listWarehouses(query: string, page: number): Promise<PageResult<WarehouseRecord>>;
  listActiveWarehouses(): Promise<readonly WarehouseRecord[]>;
  saveWarehouse(input: Omit<WarehouseInput, "id"> & { id?: string | undefined }): Promise<string>;
  setWarehouseActive(id: string, active: boolean): Promise<boolean>;
  listPostingItems(): Promise<readonly InventoryItemOption[]>;
  listPostingUnits(): Promise<readonly InventoryUnitOption[]>;
  postSingle(command: SinglePostingCommand): Promise<string>;
  transferWarehouse(command: WarehouseTransferCommand): Promise<string>;
  moveStatus(command: StatusTransferCommand): Promise<string>;
  listMovementHistory(query: MovementHistoryQuery): Promise<PageResult<MovementHistoryRecord>>;
  listStockOverview(query: string, page: number): Promise<PageResult<StockOverviewRecord>>;
  getStockBalance(itemId: string, warehouseId: string, status: InventoryStatus): Promise<string>;
  getAvailableQuantity(itemId: string, warehouseId: string): Promise<string>;
}

export type InventoryMutationResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: "forbidden" | "validation" | "reference" | "stock" | "conflict";
      message: string;
    };

export function inventoryManageForbidden(
  actor: ApplicationPrincipal,
): InventoryMutationResult | null {
  return actor.active && actor.permissions.includes("inventory.manage")
    ? null
    : { ok: false, reason: "forbidden", message: "You cannot post inventory movements." };
}

export class InventoryRepositoryError extends Error {
  constructor(
    readonly reason: "reference" | "stock" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "InventoryRepositoryError";
  }
}
