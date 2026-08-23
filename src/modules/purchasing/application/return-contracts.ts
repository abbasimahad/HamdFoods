import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { PurchaseCatalogUnit, PurchasingMutationResult, SupplierRecord } from "./contracts";

export const PURCHASE_RETURN_STATUSES = [
  "DRAFT",
  "POSTED",
  "AWAITING_REPLACEMENT",
  "COMPLETED",
  "CANCELLED",
] as const;
export type PurchaseReturnStatus = (typeof PURCHASE_RETURN_STATUSES)[number];
export const PURCHASE_RETURN_REASONS = [
  "QC_REJECTED",
  "DAMAGED",
  "PACKAGING_DEFECT",
  "WRONG_SPECIFICATION",
  "WRONG_ITEM",
  "CONTAMINATION",
  "EXPIRED",
  "SHORT_EXPIRY",
  "LATENT_DEFECT",
  "SUPPLIER_RECALL",
  "OTHER",
] as const;
export type PurchaseReturnReason = (typeof PURCHASE_RETURN_REASONS)[number];
export type PurchaseReturnSource = "QC_REJECTED" | "POST_ACCEPTANCE_DEFECT";

export type EligibleReturnSource = {
  key: string;
  source: PurchaseReturnSource;
  purchasedMaterialQuarantineId: string | null;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  purchaseOrderLineId: string;
  goodsReceiptId: string;
  goodsReceiptNumber: string;
  goodsReceiptLineId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  inventoryLotId: string;
  supplierLotNumber: string | null;
  itemId: string;
  itemCode: string;
  itemName: string;
  canonicalUnitId: string;
  canonicalUnitCode: string;
  canonicalUnitSymbol: string;
  eligibleQuantity: string;
};

export type PurchasedLotOption = Omit<
  EligibleReturnSource,
  "key" | "source" | "purchasedMaterialQuarantineId" | "eligibleQuantity"
> & {
  availableQuantity: string;
};

export type PurchaseReturnLineInput = {
  sourceKey: string;
  quantity: string;
  unitId: string;
  reason: PurchaseReturnReason;
  replacementExpected: boolean;
  notes?: string | undefined;
};
export type PurchaseReturnInput = {
  id?: string | undefined;
  returnDate: string;
  reasonNotes?: string | undefined;
  supplierReturnReference?: string | undefined;
  lines: readonly PurchaseReturnLineInput[];
  actorUserId: string;
};
export type PurchasedMaterialQuarantineInput = {
  inventoryLotId: string;
  warehouseId: string;
  quantity: string;
  unitId: string;
  reason: PurchaseReturnReason;
  notes?: string | undefined;
  actorUserId: string;
};
export type PurchaseReturnLineRecord = {
  id: string;
  sourceKey: string;
  itemCode: string;
  itemName: string;
  source: PurchaseReturnSource;
  supplierLotNumber: string | null;
  enteredQuantity: string;
  enteredUnitId: string;
  enteredUnitSymbol: string;
  normalizedQuantity: string;
  canonicalUnitSymbol: string;
  reason: PurchaseReturnReason;
  replacementExpected: boolean;
  replacementReceivedQuantity: string;
  replacementAcceptedQuantity: string;
  replacementRemainingQuantity: string;
  notes: string | null;
};
export type PurchaseReturnRecord = {
  id: string;
  number: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  originalGoodsReceiptId: string;
  originalGoodsReceiptNumber: string;
  returnDate: Date;
  sourceWarehouseId: string;
  sourceWarehouseName: string;
  status: PurchaseReturnStatus;
  reasonNotes: string | null;
  replacementExpected: boolean;
  supplierReturnReference: string | null;
  createdByName: string;
  postedByName: string | null;
  postedAt: Date | null;
  cancelledByName: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  lines: readonly PurchaseReturnLineRecord[];
  replacementGoodsReceipts: readonly {
    id: string;
    number: string;
    status: string;
    receiptDate: Date;
  }[];
};
export type PurchaseReturnQuery = {
  page: number;
  query: string;
  supplierId?: string | undefined;
  status?: PurchaseReturnStatus | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
};
export type PurchaseReturnPage = {
  records: readonly PurchaseReturnRecord[];
  page: number;
  pageCount: number;
  total: number;
};
export type ReplacementTarget = {
  purchaseReturnId: string;
  purchaseReturnNumber: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  supplierId: string;
  supplierName: string;
  lines: readonly {
    purchaseReturnLineId: string;
    purchaseOrderLineId: string;
    itemId: string;
    itemCode: string;
    itemName: string;
    canonicalUnitId: string;
    canonicalUnitCode: string;
    canonicalUnitSymbol: string;
    canonicalUnitDimension: "MASS" | "VOLUME" | "COUNT";
    remainingQuantity: string;
  }[];
};

export interface PurchaseReturnRepository {
  listEligibleReturnSources(): Promise<readonly EligibleReturnSource[]>;
  listPurchasedLotsWithAvailableStock(): Promise<readonly PurchasedLotOption[]>;
  listReturnUnits(): Promise<readonly PurchaseCatalogUnit[]>;
  listReturnSuppliers(): Promise<readonly SupplierRecord[]>;
  createPurchaseReturn(input: PurchaseReturnInput): Promise<string>;
  updatePurchaseReturn(input: PurchaseReturnInput & { id: string }): Promise<string>;
  postPurchaseReturn(id: string, actorUserId: string): Promise<void>;
  cancelPurchaseReturn(id: string, reason: string, actorUserId: string): Promise<void>;
  quarantinePurchasedMaterial(input: PurchasedMaterialQuarantineInput): Promise<string>;
  getPurchaseReturn(id: string): Promise<PurchaseReturnRecord | null>;
  listPurchaseReturns(query: PurchaseReturnQuery): Promise<PurchaseReturnPage>;
  listReplacementTargets(): Promise<readonly ReplacementTarget[]>;
}

export function requirePurchaseReturnManager(
  actor: ApplicationPrincipal,
): PurchasingMutationResult | null {
  return actor.active && actor.permissions.includes("purchasing.manage")
    ? null
    : { ok: false, message: "Purchasing management permission is required." };
}
