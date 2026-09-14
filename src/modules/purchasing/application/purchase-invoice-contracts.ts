import type { SupplierRecord, PageResult } from "./contracts";

export const PURCHASE_INVOICE_STATUSES = ["DRAFT", "POSTED", "CANCELLED", "REVERSED"] as const;
export type PurchaseInvoiceStatus = (typeof PURCHASE_INVOICE_STATUSES)[number];

export type EligiblePurchaseOrderLineForInvoice = {
  purchaseOrderLineId: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  canonicalUnitSymbol: string;
  orderedQuantity: string;
  poUnitRate: string;
  poTaxPercent: string;
};

export type EligibleGoodsReceiptLineForMatch = {
  goodsReceiptLineId: string;
  goodsReceiptId: string;
  goodsReceiptNumber: string;
  purchaseOrderLineId: string;
  itemId: string;
  acceptedQuantity: string;
  matchedToDate: string;
  remainingToInvoice: string;
  grnDerivedUnitCost: string;
};

export type PurchaseInvoiceLineMatchInput = {
  goodsReceiptLineId: string;
  matchedQuantity: string;
};
export type PurchaseInvoiceLineInput = {
  purchaseOrderLineId: string;
  invoicedQuantity: string;
  invoicedUnitRate: string;
  taxPercent: string;
  notes?: string | undefined;
  matches: readonly PurchaseInvoiceLineMatchInput[];
};
export type PurchaseInvoiceInput = {
  id?: string | undefined;
  supplierId: string;
  supplierInvoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | undefined;
  notes?: string | undefined;
  lines: readonly PurchaseInvoiceLineInput[];
  actorUserId: string;
};

export type PurchaseInvoiceLineMatchRecord = {
  id: string;
  goodsReceiptLineId: string;
  goodsReceiptNumber: string;
  matchedQuantity: string;
  grnDerivedUnitCost: string;
  grnDerivedTaxAmount: string;
  priceVarianceAmount: string;
  taxVarianceAmount: string;
};
export type PurchaseInvoiceLineRecord = {
  id: string;
  position: number;
  purchaseOrderLineId: string;
  purchaseOrderNumber: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  canonicalUnitSymbol: string;
  invoicedQuantity: string;
  invoicedUnitRate: string;
  taxPercent: string;
  grossAmount: string;
  taxAmount: string;
  netAmount: string;
  notes: string | null;
  matchedQuantityTotal: string;
  matches: readonly PurchaseInvoiceLineMatchRecord[];
};
export type PurchaseInvoiceRecord = {
  id: string;
  number: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date | null;
  status: PurchaseInvoiceStatus;
  notes: string | null;
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  priceVarianceTotal: string;
  taxVarianceTotal: string;
  createdByName: string;
  postedByName: string | null;
  postedAt: Date | null;
  cancelledByName: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  reversedByName: string | null;
  reversedAt: Date | null;
  reversalReason: string | null;
  createdAt: Date;
  lines: readonly PurchaseInvoiceLineRecord[];
};
export type PurchaseInvoiceListRecord = Omit<PurchaseInvoiceRecord, "lines">;

export type PurchaseInvoiceQuery = {
  page: number;
  query: string;
  supplierId?: string | undefined;
  status?: PurchaseInvoiceStatus | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
};

export interface PurchaseInvoiceRepository {
  listEligiblePurchaseOrderLines(): Promise<readonly EligiblePurchaseOrderLineForInvoice[]>;
  listEligibleGoodsReceiptLines(): Promise<readonly EligibleGoodsReceiptLineForMatch[]>;
  listInvoiceSuppliers(): Promise<readonly SupplierRecord[]>;
  createPurchaseInvoice(input: PurchaseInvoiceInput): Promise<string>;
  updatePurchaseInvoice(input: PurchaseInvoiceInput & { id: string }): Promise<string>;
  postPurchaseInvoice(id: string, actorUserId: string): Promise<void>;
  cancelPurchaseInvoice(id: string, reason: string, actorUserId: string): Promise<void>;
  reversePurchaseInvoice(id: string, reason: string, actorUserId: string): Promise<void>;
  getPurchaseInvoice(id: string): Promise<PurchaseInvoiceRecord | null>;
  listPurchaseInvoices(query: PurchaseInvoiceQuery): Promise<PageResult<PurchaseInvoiceListRecord>>;
}
