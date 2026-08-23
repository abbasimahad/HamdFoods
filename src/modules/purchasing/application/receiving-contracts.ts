import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { PurchaseCatalogUnit, PurchasingMutationResult, SupplierRecord } from "./contracts";
import type { ReplacementTarget } from "./return-contracts";

export const GOODS_RECEIPT_STATUSES = ["DRAFT", "POSTED", "QC_COMPLETED", "CANCELLED"] as const;
export type GoodsReceiptStatus = (typeof GOODS_RECEIPT_STATUSES)[number];
export const QC_REJECTION_REASONS = [
  "DAMAGED",
  "WRONG_ITEM",
  "WRONG_SPECIFICATION",
  "QUALITY_FAILURE",
  "EXPIRED",
  "SHORT_EXPIRY",
  "CONTAMINATION",
  "PACKAGING_DEFECT",
  "OTHER",
] as const;
export type QcRejectionReason = (typeof QC_REJECTION_REASONS)[number];

export type ReceivingWarehouseOption = { id: string; code: string; name: string; active: boolean };
export type ReceivablePoLine = {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: "RAW_MATERIAL" | "PACKAGING_MATERIAL";
  orderedQuantity: string;
  canonicalUnitId: string;
  canonicalUnitCode: string;
  canonicalUnitSymbol: string;
  canonicalUnitDimension: "MASS" | "VOLUME" | "COUNT";
  pendingQcQuantity: string;
  acceptedQuantity: string;
  returnedAcceptedQuantity: string;
  rejectedQuantity: string;
  remainingToReceive: string;
  remainingToFulfil: string;
};
export type ReceivablePurchaseOrder = {
  id: string;
  number: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  status: "APPROVED" | "PARTIALLY_RECEIVED";
  lines: readonly ReceivablePoLine[];
};
export type GoodsReceiptLineInput = {
  purchaseOrderLineId: string;
  quantity: string;
  unitId: string;
  supplierLotNumber?: string | undefined;
  manufacturingDate?: string | undefined;
  expiryDate?: string | undefined;
  notes?: string | undefined;
  purchaseReturnLineId?: string | undefined;
};
export type GoodsReceiptInput = {
  id?: string | undefined;
  purchaseOrderId: string;
  receiptDate: string;
  warehouseId: string;
  supplierDeliveryNumber?: string | undefined;
  vehicleReference?: string | undefined;
  notes?: string | undefined;
  lines: readonly GoodsReceiptLineInput[];
  actorUserId: string;
  purpose?: "PURCHASE" | "SUPPLIER_REPLACEMENT" | undefined;
  purchaseReturnId?: string | undefined;
};
export type QcDecisionInput = {
  goodsReceiptLineId: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  rejectionReason?: QcRejectionReason | undefined;
  rejectionNotes?: string | undefined;
};
export type GoodsReceiptLineRecord = {
  id: string;
  position: number;
  purchaseOrderLineId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  orderedQuantity: string;
  enteredQuantity: string;
  enteredUnitId: string;
  enteredUnitCode: string;
  enteredUnitSymbol: string;
  normalizedQuantity: string;
  canonicalUnitId: string;
  canonicalUnitCode: string;
  canonicalUnitSymbol: string;
  supplierLotNumber: string | null;
  manufacturingDate: Date | null;
  expiryDate: Date | null;
  notes: string | null;
  inventoryLotId: string | null;
  acceptedQuantity: string;
  rejectedQuantity: string;
  rejectionReason: QcRejectionReason | null;
  rejectionNotes: string | null;
  purchaseReturnLineId: string | null;
};
export type GoodsReceiptRecord = {
  id: string;
  number: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  receiptDate: Date;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  supplierDeliveryNumber: string | null;
  vehicleReference: string | null;
  notes: string | null;
  status: GoodsReceiptStatus;
  purpose: "PURCHASE" | "SUPPLIER_REPLACEMENT";
  purchaseReturnId: string | null;
  purchaseReturnNumber: string | null;
  receivedByName: string;
  postedByName: string | null;
  postedAt: Date | null;
  qcByName: string | null;
  qcCompletedAt: Date | null;
  cancelledByName: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  lines: readonly GoodsReceiptLineRecord[];
};
export type GoodsReceiptQuery = {
  page: number;
  query: string;
  supplierId?: string | undefined;
  status?: GoodsReceiptStatus | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
};
export type GoodsReceiptPage = {
  records: readonly GoodsReceiptRecord[];
  page: number;
  pageCount: number;
  total: number;
};
export type PurchaseOrderProgress = {
  lines: readonly ReceivablePoLine[];
  goodsReceipts: readonly {
    id: string;
    number: string;
    status: GoodsReceiptStatus;
    receiptDate: Date;
    warehouseName: string;
  }[];
};

export interface GoodsReceiptRepository {
  listReceivablePurchaseOrders(): Promise<readonly ReceivablePurchaseOrder[]>;
  getReceivablePurchaseOrder(id: string): Promise<ReceivablePurchaseOrder | null>;
  listReceivingWarehouses(): Promise<readonly ReceivingWarehouseOption[]>;
  listReceivingUnits(): Promise<readonly PurchaseCatalogUnit[]>;
  listReceivingSuppliers(): Promise<readonly SupplierRecord[]>;
  listReplacementTargets(): Promise<readonly ReplacementTarget[]>;
  createGoodsReceipt(input: GoodsReceiptInput): Promise<string>;
  updateGoodsReceipt(input: GoodsReceiptInput & { id: string }): Promise<string>;
  postGoodsReceipt(id: string, actorUserId: string): Promise<void>;
  cancelGoodsReceipt(id: string, reason: string, actorUserId: string): Promise<void>;
  completeGoodsReceiptQc(
    id: string,
    decisions: readonly QcDecisionInput[],
    actorUserId: string,
  ): Promise<void>;
  getGoodsReceipt(id: string): Promise<GoodsReceiptRecord | null>;
  listGoodsReceipts(query: GoodsReceiptQuery): Promise<GoodsReceiptPage>;
  getPurchaseOrderProgress(id: string): Promise<PurchaseOrderProgress>;
}

export function requireReceivingManager(
  actor: ApplicationPrincipal,
): PurchasingMutationResult | null {
  return actor.active && actor.permissions.includes("purchasing.manage")
    ? null
    : { ok: false, message: "Purchasing management permission is required." };
}
